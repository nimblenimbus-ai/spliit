import { getGroup, getGroupExpenses } from '@/lib/api'
import {
  getBalances,
  getDirectPairwiseDebts,
  getPublicBalances,
  getReimbursements,
  getSuggestedReimbursements,
} from '@/lib/balances'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

export const listGroupBalancesProcedure = baseProcedure
  .input(z.object({ groupId: z.string().min(1) }))
  .query(async ({ input: { groupId } }) => {
    const [group, expenses] = await Promise.all([
      getGroup(groupId),
      getGroupExpenses(groupId),
    ])
    const balances = getBalances(expenses)
    const simplifiedReimbursements = getReimbursements(balances)
    const pairwiseReimbursements = getDirectPairwiseDebts(
      expenses,
      group?.participants,
    )
    const simplifyDebts = group?.simplifyDebts ?? true
    const reimbursements = simplifyDebts
      ? simplifiedReimbursements
      : pairwiseReimbursements
    const publicBalances = getPublicBalances(simplifiedReimbursements)

    return {
      balances: publicBalances,
      reimbursements,
      simplifiedReimbursements,
      pairwiseReimbursements,
      simplifyDebts,
    }
  })

