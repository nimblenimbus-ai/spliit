import { updateGroupSimplifyDebts } from '@/lib/api'
import { baseProcedure } from '@/trpc/init'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

export const toggleSimplifyDebtsProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      simplifyDebts: z.boolean(),
      participantId: z.string().optional(),
    }),
  )
  .mutation(async ({ input: { groupId, simplifyDebts, participantId } }) => {
    const group = await updateGroupSimplifyDebts(
      groupId,
      simplifyDebts,
      participantId,
    )
    try {
      revalidatePath(`/groups/${groupId}/balances`)
      revalidatePath(`/groups/${groupId}`)
    } catch {
      // Ignore if called outside of Next.js request context (e.g. unit tests)
    }
    return { group }
  })
