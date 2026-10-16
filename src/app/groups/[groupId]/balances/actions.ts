'use server'

import { updateGroupSimplifyDebts } from '@/lib/api'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const toggleSimplifyDebtsSchema = z.object({
  groupId: z.string().min(1),
  enabled: z.boolean(),
  participantId: z.string().optional(),
})

export async function toggleSimplifyDebts(
  groupId: string,
  enabled: boolean,
  participantId?: string,
) {
  const parsed = toggleSimplifyDebtsSchema.parse({
    groupId,
    enabled,
    participantId,
  })
  const group = await updateGroupSimplifyDebts(
    parsed.groupId,
    parsed.enabled,
    parsed.participantId,
  )
  revalidatePath(`/groups/${parsed.groupId}/balances`)
  revalidatePath(`/groups/${parsed.groupId}`)
  return group
}
