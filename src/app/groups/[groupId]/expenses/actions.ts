'use server'

import { ActivityType } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { randomId } from '@/lib/random'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const CREATE_PREFIX = '__create__:'

const moveExpenseInputSchema = z.object({
  expenseId: z.string().min(1),
  sourceGroupId: z.string().min(1),
  targetGroupId: z.string().min(1),
  participantMapping: z.record(z.string(), z.string().min(1)),
})

export type MoveExpenseInput = z.infer<typeof moveExpenseInputSchema>

export async function moveExpenseToGroup(input: MoveExpenseInput) {
  const { expenseId, sourceGroupId, targetGroupId, participantMapping } =
    moveExpenseInputSchema.parse(input)

  if (sourceGroupId === targetGroupId) {
    throw new Error('Destination group must be different from the current group.')
  }

  const result = await prisma.$transaction(async (tx) => {
    // 1. Fetch the original Expense including paidFor (splits) and verify it belongs to sourceGroupId
    const expense = await tx.expense.findUnique({
      where: { id: expenseId },
      include: {
        paidFor: true,
        paidBy: true,
      },
    })

    if (!expense || expense.groupId !== sourceGroupId) {
      throw new Error('Expense not found in the source group.')
    }

    // 2. Verify that targetGroupId exists and fetch all its participants
    const targetGroup = await tx.group.findUnique({
      where: { id: targetGroupId },
      include: { participants: true },
    })

    if (!targetGroup) {
      throw new Error('Target group not found.')
    }

    const validTargetParticipantIds = new Set(
      targetGroup.participants.map((p) => p.id),
    )

    // Collect all source participant IDs involved in this expense
    const involvedSourceParticipantIds = Array.from(
      new Set([
        expense.paidById,
        ...expense.paidFor.map((pf) => pf.participantId),
      ]),
    )

    // 3 & 4. Resolve mappings and create any new participants (__create__:<Name>) under targetGroupId
    const resolvedTargetParticipantIdBySourceId = new Map<string, string>()
    const createdParticipantIdByLowerName = new Map<string, string>()

    for (const sourceParticipantId of involvedSourceParticipantIds) {
      const rawTargetSpec = participantMapping[sourceParticipantId]?.trim()
      if (!rawTargetSpec) {
        throw new Error(
          `Missing participant mapping for participant "${sourceParticipantId}".`,
        )
      }

      if (rawTargetSpec.startsWith(CREATE_PREFIX)) {
        const newName = rawTargetSpec.slice(CREATE_PREFIX.length).trim()
        if (!newName) {
          throw new Error('New participant name cannot be empty.')
        }

        const lowerKey = newName.toLowerCase()
        let createdId = createdParticipantIdByLowerName.get(lowerKey)

        if (!createdId) {
          const newParticipant = await tx.participant.create({
            data: {
              id: randomId(),
              name: newName,
              groupId: targetGroupId,
            },
          })
          createdId = newParticipant.id
          createdParticipantIdByLowerName.set(lowerKey, createdId)
          validTargetParticipantIds.add(createdId)
        }

        resolvedTargetParticipantIdBySourceId.set(
          sourceParticipantId,
          createdId,
        )
      } else {
        if (!validTargetParticipantIds.has(rawTargetSpec)) {
          throw new Error(
            `Mapped participant "${rawTargetSpec}" does not belong to target group "${targetGroup.name}".`,
          )
        }
        resolvedTargetParticipantIdBySourceId.set(
          sourceParticipantId,
          rawTargetSpec,
        )
      }
    }

    const mappedPaidById = resolvedTargetParticipantIdBySourceId.get(
      expense.paidById,
    )
    if (!mappedPaidById) {
      throw new Error('Failed to resolve mapped payer in target group.')
    }

    // Aggregate shares in case multiple source participants are mapped to the same target participant
    const sharesByTargetParticipantId = new Map<string, number>()
    for (const pf of expense.paidFor) {
      const targetPid = resolvedTargetParticipantIdBySourceId.get(
        pf.participantId,
      )
      if (!targetPid) {
        throw new Error(
          `Failed to resolve mapped split participant for "${pf.participantId}".`,
        )
      }
      sharesByTargetParticipantId.set(
        targetPid,
        (sharesByTargetParticipantId.get(targetPid) ?? 0) + pf.shares,
      )
    }

    // 5. Delete existing ExpensePaidFor records for this expense
    await tx.expensePaidFor.deleteMany({
      where: { expenseId: expense.id },
    })

    // Keep RecurringExpenseLink in sync if the expense is recurring
    await tx.recurringExpenseLink.updateMany({
      where: { currentFrameExpenseId: expense.id },
      data: { groupId: targetGroupId },
    })

    // 6. Update the Expense record and recreate ExpensePaidFor records
    const updatedExpense = await tx.expense.update({
      where: { id: expense.id },
      data: {
        groupId: targetGroupId,
        paidById: mappedPaidById,
        paidFor: {
          create: Array.from(sharesByTargetParticipantId.entries()).map(
            ([participantId, shares]) => ({
              participantId,
              shares,
            }),
          ),
        },
      },
    })

    // Record activity in both source and target groups
    await tx.activity.createMany({
      data: [
        {
          id: randomId(),
          groupId: sourceGroupId,
          activityType: ActivityType.DELETE_EXPENSE,
          expenseId: expense.id,
          data: `${expense.title} (moved to ${targetGroup.name})`,
        },
        {
          id: randomId(),
          groupId: targetGroupId,
          activityType: ActivityType.CREATE_EXPENSE,
          expenseId: expense.id,
          participantId: mappedPaidById,
          data: expense.title,
        },
      ],
    })

    return {
      expenseId: updatedExpense.id,
      targetGroupId: targetGroup.id,
      targetGroupName: targetGroup.name,
    }
  })

  // 7. Revalidate Next.js cache paths for both source and target balance and expense lists
  revalidatePath(`/groups/${sourceGroupId}`)
  revalidatePath(`/groups/${sourceGroupId}/expenses`)
  revalidatePath(`/groups/${sourceGroupId}/balances`)
  revalidatePath(`/groups/${targetGroupId}`)
  revalidatePath(`/groups/${targetGroupId}/expenses`)
  revalidatePath(`/groups/${targetGroupId}/balances`)

  return result
}
