import { getCrossGroupBalances } from '@/app/actions/cross-group-balances'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const crossGroupBalancesProcedure = baseProcedure
  .input(
    z.object({
      activeGroupIds: z.array(z.string().min(1)).max(150),
      selectedName: z.string().optional(),
    }),
  )
  .query(async ({ input: { activeGroupIds, selectedName } }) => {
    return getCrossGroupBalances(selectedName ?? '', activeGroupIds)
  })
