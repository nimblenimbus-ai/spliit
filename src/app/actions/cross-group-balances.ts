'use server'

import {
  getBalances,
  getDirectPairwiseDebts,
  getSuggestedReimbursements,
  Reimbursement,
} from '@/lib/balances'
import { Currency, getCurrency } from '@/lib/currency'
import { prisma } from '@/lib/prisma'

export type CounterpartyGroupDetail = {
  groupId: string
  groupName: string
  amount: number // > 0 = counterparty owes user, < 0 = user owes counterparty, 0 = settled
  currency: Currency
}

export type CounterpartySummary = {
  name: string
  normalizedName: string
  netAmount: number // aggregate net amount across groups
  currency: Currency
  groupCount: number
  groups: CounterpartyGroupDetail[]
}

export type UniqueParticipantSummary = {
  normalizedName: string
  displayName: string
  groupCount: number
}

export type CrossGroupBalancesResult = {
  uniqueParticipants: UniqueParticipantSummary[]
  selectedName: string
  totalNetByCurrency: {
    currency: Currency
    amount: number
  }[]
  counterparties: CounterpartySummary[]
}

const DEFAULT_CURRENCY: Currency = {
  symbol: '£',
  name: 'British Pound',
  symbol_native: '£',
  decimal_digits: 2,
  rounding: 0,
  code: 'GBP',
  name_plural: 'British pounds',
}

/**
 * Calculates net cross-group bilateral balances relative to `selectedName`
 * across the specified active (unarchived) groups.
 */
export async function getCrossGroupBalances(
  selectedName: string,
  activeGroupIds: string[],
): Promise<CrossGroupBalancesResult> {
  if (!activeGroupIds || activeGroupIds.length === 0) {
    return {
      uniqueParticipants: [],
      selectedName: selectedName || '',
      totalNetByCurrency: [],
      counterparties: [],
    }
  }

  // 1. Fetch all active groups with their participants and expenses
  const groups = await prisma.group.findMany({
    where: { id: { in: activeGroupIds } },
    select: {
      id: true,
      name: true,
      currency: true,
      currencyCode: true,
      simplifyDebts: true,
      participants: {
        select: {
          id: true,
          name: true,
        },
      },
      expenses: {
        select: {
          id: true,
          amount: true,
          splitMode: true,
          paidById: true,
          isReimbursement: true,
          paidBy: { select: { id: true, name: true } },
          paidFor: {
            select: {
              participantId: true,
              shares: true,
              participant: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  })

  // 2. Discover all unique participants across all groups grouped by normalized name
  const participantStats = new Map<
    string,
    { normalizedName: string; displayName: string; groupCount: number }
  >()

  for (const group of groups) {
    const seenInThisGroup = new Set<string>()
    for (const p of group.participants) {
      const trimmed = p.name.trim()
      const norm = trimmed.toLowerCase()
      if (!norm) continue

      if (!seenInThisGroup.has(norm)) {
        seenInThisGroup.add(norm)
        const existing = participantStats.get(norm)
        if (existing) {
          existing.groupCount += 1
          // Preserve the most well-capitalized version
          if (
            trimmed !== existing.displayName &&
            trimmed[0] === trimmed[0].toUpperCase() &&
            existing.displayName[0] !== existing.displayName[0].toUpperCase()
          ) {
            existing.displayName = trimmed
          }
        } else {
          participantStats.set(norm, {
            normalizedName: norm,
            displayName: trimmed,
            groupCount: 1,
          })
        }
      }
    }
  }

  const uniqueParticipants = Array.from(participantStats.values()).sort(
    (a, b) => {
      // Sort by groupCount descending, then displayName ascending
      if (b.groupCount !== a.groupCount) return b.groupCount - a.groupCount
      return a.displayName.localeCompare(b.displayName)
    },
  )

  // 3. Resolve active perspective selection
  let resolvedNormalized = selectedName.trim().toLowerCase()
  let resolvedDisplayName = selectedName.trim()

  if (!resolvedNormalized || !participantStats.has(resolvedNormalized)) {
    // Default to "Jek Tan" / "Jek" if present, otherwise participant with most groups
    const jek =
      participantStats.get('jek tan') ??
      participantStats.get('jek') ??
      uniqueParticipants[0]

    if (jek) {
      resolvedNormalized = jek.normalizedName
      resolvedDisplayName = jek.displayName
    }
  } else {
    resolvedDisplayName =
      participantStats.get(resolvedNormalized)?.displayName ??
      resolvedDisplayName
  }

  if (!resolvedNormalized) {
    return {
      uniqueParticipants,
      selectedName: '',
      totalNetByCurrency: [],
      counterparties: [],
    }
  }

  // 4. Calculate pairwise reimbursements relative to `resolvedNormalized` per group
  const totalNetByCurrencyMap = new Map<string, { currency: Currency; amount: number }>()

  // Map of normalized counterparty name -> CounterpartySummary
  const counterpartyMap = new Map<string, CounterpartySummary>()

  for (const group of groups) {
    const groupCurrency = group.currencyCode
      ? getCurrency(group.currencyCode)
      : { ...DEFAULT_CURRENCY, symbol: group.currency || '£' }
    const currencyKey = groupCurrency.code || groupCurrency.symbol

    // Find the participant in this group matching the active perspective
    const meParticipant = group.participants.find(
      (p) => p.name.trim().toLowerCase() === resolvedNormalized,
    )

    // Collect all other participants present in this group
    const otherParticipantsInGroup = group.participants.filter(
      (p) => p.name.trim().toLowerCase() !== resolvedNormalized,
    )

    // Calculate group reimbursements
    let reimbursements: Reimbursement[] = []
    if (group.expenses.length > 0) {
      if (group.simplifyDebts !== false) {
        reimbursements = getSuggestedReimbursements(getBalances(group.expenses as any))
      } else {
        reimbursements = getDirectPairwiseDebts(group.expenses as any, group.participants)
      }
    }

    // Build participant ID -> participant object lookup for this group
    const pById = new Map(group.participants.map((p) => [p.id, p]))

    // Track bilateral net between `meParticipant` and each other participant in this group
    const groupBilateralNet = new Map<string, number>() // key: normalized counterparty name -> amount relative to me

    if (meParticipant) {
      for (const r of reimbursements) {
        if (r.from === meParticipant.id) {
          // I owe toParticipant
          const toP = pById.get(r.to)
          if (toP) {
            const cpNorm = toP.name.trim().toLowerCase()
            groupBilateralNet.set(
              cpNorm,
              (groupBilateralNet.get(cpNorm) ?? 0) - r.amount,
            )
          }
        } else if (r.to === meParticipant.id) {
          // fromParticipant owes me
          const fromP = pById.get(r.from)
          if (fromP) {
            const cpNorm = fromP.name.trim().toLowerCase()
            groupBilateralNet.set(
              cpNorm,
              (groupBilateralNet.get(cpNorm) ?? 0) + r.amount,
            )
          }
        }
      }
    }

    // Now record this group for every other participant present in the group
    if (meParticipant) {
      for (const otherP of otherParticipantsInGroup) {
        const cpNorm = otherP.name.trim().toLowerCase()
        if (!cpNorm) continue

        const netInGroup = groupBilateralNet.get(cpNorm) ?? 0

        let cpEntry = counterpartyMap.get(cpNorm)
        if (!cpEntry) {
          cpEntry = {
            name: otherP.name.trim(),
            normalizedName: cpNorm,
            netAmount: 0,
            currency: groupCurrency,
            groupCount: 0,
            groups: [],
          }
          counterpartyMap.set(cpNorm, cpEntry)
        }

        cpEntry.netAmount += netInGroup
        cpEntry.groupCount += 1
        cpEntry.groups.push({
          groupId: group.id,
          groupName: group.name,
          amount: netInGroup,
          currency: groupCurrency,
        })
      }
    }

    // Aggregate user's overall total net balance across groups
    if (meParticipant) {
      const netSumInGroup = Array.from(groupBilateralNet.values()).reduce(
        (sum, amt) => sum + amt,
        0,
      )

      if (netSumInGroup !== 0) {
        let currEntry = totalNetByCurrencyMap.get(currencyKey)
        if (!currEntry) {
          currEntry = { currency: groupCurrency, amount: 0 }
          totalNetByCurrencyMap.set(currencyKey, currEntry)
        }
        currEntry.amount += netSumInGroup
      }
    }
  }

  // 5. Sort groups inside each counterparty: non-zero amounts first, then alphabetical
  for (const cp of counterpartyMap.values()) {
    cp.groups.sort((g1, g2) => {
      const abs1 = Math.abs(g1.amount)
      const abs2 = Math.abs(g2.amount)
      if (abs1 !== abs2) return abs2 - abs1
      return g1.groupName.localeCompare(g2.groupName)
    })
  }

  // 6. Sort counterparties:
  // - Counterparties who are owed money (netAmount < 0, you owe them, red) first (largest debt first)
  // - Counterparties who owe money (netAmount > 0, they owe you, green) next (largest credit first)
  // - Settled counterparties (netAmount === 0) last
  const sortedCounterparties = Array.from(counterpartyMap.values()).sort(
    (a, b) => {
      const aOwes = a.netAmount < 0
      const bOwes = b.netAmount < 0
      const aOwed = a.netAmount > 0
      const bOwed = b.netAmount > 0

      if (aOwes && !bOwes) return -1
      if (!aOwes && bOwes) return 1
      if (aOwes && bOwes) return a.netAmount - b.netAmount // most negative first (e.g. -100 before -20)

      if (aOwed && !bOwed) return -1
      if (!aOwed && bOwed) return 1
      if (aOwed && bOwed) return b.netAmount - a.netAmount // largest positive first

      return a.name.localeCompare(b.name)
    },
  )

  const totalNetByCurrency = Array.from(totalNetByCurrencyMap.values())

  return {
    uniqueParticipants,
    selectedName: resolvedDisplayName,
    totalNetByCurrency,
    counterparties: sortedCounterparties,
  }
}
