import { env } from '@/lib/env'
import { prisma } from '@/lib/prisma'
import { getUploadKeyFromUrl } from '@/lib/uploaded-image-url'
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3'

export type PurgeResult = {
  purgedGroupIds: string[]
  failedGroupIds: string[]
}

const S3_DELETE_CONCURRENCY = 10

let s3Client: S3Client | undefined

// Configured the same way next-s3-upload configures the client it uploads with
// (see src/app/api/s3-upload/route.ts).
function getS3Client() {
  s3Client ??= new S3Client({
    credentials: {
      accessKeyId: env.S3_UPLOAD_KEY ?? '',
      secretAccessKey: env.S3_UPLOAD_SECRET ?? '',
    },
    region: env.S3_UPLOAD_REGION,
    endpoint: env.S3_UPLOAD_ENDPOINT,
    forcePathStyle: !!env.S3_UPLOAD_ENDPOINT,
  })
  return s3Client
}

/**
 * Permanently deletes every group whose deletion grace period has ended, with
 * all its data and uploaded documents. A group that fails is left in place, so
 * the next run retries it.
 */
export async function purgeScheduledGroups(
  now = new Date(),
): Promise<PurgeResult> {
  const groups = await prisma.group.findMany({
    where: { deleteAt: { lte: now } },
    select: { id: true },
  })

  const result: PurgeResult = { purgedGroupIds: [], failedGroupIds: [] }
  for (const { id } of groups) {
    try {
      await purgeGroup(id, now)
      result.purgedGroupIds.push(id)
    } catch (error) {
      console.error(`Failed to purge group ${id}`, error)
      result.failedGroupIds.push(id)
    }
  }
  return result
}

async function purgeGroup(groupId: string, now: Date) {
  await permanentlyDeleteGroup(groupId, undefined, now)
}

/**
 * Permanently deletes a group with all its data, expenses, participants,
 * activities, and uploaded documents.
 */
export async function permanentlyDeleteGroup(
  groupId: string,
  groupName?: string,
  now?: Date,
) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, name: true, deleteAt: true },
  })
  if (!group) throw new Error('Invalid group ID')

  if (
    groupName !== undefined &&
    group.name.trim().toLowerCase() !== groupName.trim().toLowerCase()
  ) {
    throw new Error('Group name does not match')
  }

  // If a purge deadline was specified (from cron job), enforce it
  if (now !== undefined && (!group.deleteAt || group.deleteAt > now)) {
    throw new Error(
      'Group is not scheduled for deletion or deadline not reached',
    )
  }

  const documents = await prisma.expenseDocument.findMany({
    where: { Expense: { groupId } },
    select: { id: true, url: true },
  })

  // Files go first: once the rows are gone, nothing points to them anymore.
  // URLs outside the configured bucket are not ours to delete.
  const keys = documents
    .map(({ url }) => getUploadKeyFromUrl(url))
    .filter((key): key is string => key !== null)
  if (keys.length > 0 && env.S3_UPLOAD_BUCKET) {
    for (let i = 0; i < keys.length; i += S3_DELETE_CONCURRENCY) {
      await Promise.all(
        keys.slice(i, i + S3_DELETE_CONCURRENCY).map((key) =>
          getS3Client()
            .send(
              new DeleteObjectCommand({
                Bucket: env.S3_UPLOAD_BUCKET,
                Key: key,
              }),
            )
            .catch((err) => {
              console.warn(`Failed to delete S3 object ${key}`, err)
            }),
        ),
      )
    }
  }

  // Remove groupId from any sync GroupDirectory
  const matchingDirectories = await prisma.groupDirectory.findMany({
    where: { groupIds: { has: groupId } },
    select: { id: true, groupIds: true },
  })
  for (const dir of matchingDirectories) {
    await prisma.groupDirectory.update({
      where: { id: dir.id },
      data: { groupIds: dir.groupIds.filter((id) => id !== groupId) },
    })
  }

  // Deleting the group cascades to its participants, expenses, splits and activities.
  await prisma.$transaction([
    prisma.expenseDocument.deleteMany({
      where: { id: { in: documents.map((document) => document.id) } },
    }),
    prisma.group.delete({ where: { id: groupId } }),
  ])
}
