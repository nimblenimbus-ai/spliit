'use server'

import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const syncKeyInputSchema = z.object({
  syncKey: z
    .string()
    .trim()
    .min(2, 'Sync key must be at least 2 characters.')
    .max(64, 'Sync key must be at most 64 characters.'),
  groupIds: z.array(z.string().min(1)).min(1, 'Select at least one group.'),
  label: z.string().trim().max(120).optional(),
})

export type SyncedGroupSummary = {
  id: string
  name: string
  currency: string
  updatedAt: Date
}

export async function createOrUpdateSyncKey(
  syncKey: string,
  groupIds: string[],
  label?: string,
) {
  const parsed = syncKeyInputSchema.parse({ syncKey, groupIds, label })
  const normalizedKey = parsed.syncKey.trim().toUpperCase()
  const uniqueGroupIds = Array.from(new Set(parsed.groupIds))

  const directory = await prisma.groupDirectory.upsert({
    where: { syncKey: normalizedKey },
    update: {
      groupIds: uniqueGroupIds,
      ...(parsed.label !== undefined ? { label: parsed.label || null } : {}),
    },
    create: {
      syncKey: normalizedKey,
      groupIds: uniqueGroupIds,
      label: parsed.label || null,
    },
  })

  return {
    id: directory.id,
    syncKey: directory.syncKey,
    label: directory.label,
    groupIds: directory.groupIds,
    updatedAt: directory.updatedAt,
  }
}

export async function fetchGroupsBySyncKey(
  syncKey: string,
): Promise<{
  syncKey: string
  label: string | null
  groups: SyncedGroupSummary[]
}> {
  const normalizedKey = syncKey.trim().toUpperCase()
  if (!normalizedKey) {
    throw new Error('Please enter a valid Sync Key.')
  }

  const directory = await prisma.groupDirectory.findUnique({
    where: { syncKey: normalizedKey },
  })

  if (!directory) {
    throw new Error(
      `No saved groups found for Sync Key "${normalizedKey}". Please check the code and try again.`,
    )
  }

  const dbGroups = await prisma.group.findMany({
    where: {
      id: { in: directory.groupIds },
    },
    select: {
      id: true,
      name: true,
      currency: true,
      createdAt: true,
    },
  })

  const groupMap = new Map(dbGroups.map((g) => [g.id, g]))
  const orderedGroups: SyncedGroupSummary[] = []
  for (const id of directory.groupIds) {
    const g = groupMap.get(id)
    if (g) {
      orderedGroups.push({
        id: g.id,
        name: g.name,
        currency: g.currency,
        updatedAt: g.createdAt,
      })
    }
  }

  return {
    syncKey: directory.syncKey,
    label: directory.label,
    groups: orderedGroups,
  }
}
