import { SplitMode } from '@/generated/prisma/client'
import { supportedCurrencyCodes } from '@/lib/currency'
import { prisma } from '@/lib/prisma'
import { randomId } from '@/lib/random'
import { parseSplitwiseCsv } from '@/lib/splitwise-csv'
import { baseProcedure } from '@/trpc/init'
import { z } from 'zod'

const currencySymbolMap: Record<string, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
  AUD: 'A$',
  CAD: 'CA$',
  RON: 'lei',
  TRY: '₺',
  PLN: 'zł',
  CHF: 'CHF',
  ZAR: 'R',
  MAD: 'MAD',
  JPY: '¥',
}

function mapCategoryNameToId(name: string, isReimbursement: boolean): number {
  if (isReimbursement) return 1
  const n = name.trim().toLowerCase()
  const map: Record<string, number> = {
    general: 0,
    payment: 1,
    entertainment: 2,
    'entertainment - other': 2,
    games: 3,
    movies: 4,
    music: 5,
    sports: 6,
    'food and drink': 7,
    'food and drink - other': 7,
    'dining out': 8,
    groceries: 9,
    liquor: 10,
    home: 11,
    'home - other': 11,
    electronics: 12,
    furniture: 13,
    'household supplies': 14,
    maintenance: 15,
    mortgage: 16,
    pets: 17,
    rent: 18,
    services: 19,
    childcare: 20,
    clothing: 21,
    education: 22,
    gifts: 23,
    insurance: 24,
    'medical expenses': 25,
    taxes: 26,
    transportation: 27,
    'transportation - other': 27,
    bicycle: 28,
    'bus/train': 29,
    car: 30,
    'gas/fuel': 31,
    hotel: 32,
    parking: 33,
    plane: 34,
    taxi: 35,
    utilities: 36,
    'utilities - other': 36,
    cleaning: 37,
    electricity: 38,
    'heat/gas': 39,
    trash: 40,
    'tv/phone/internet': 41,
    water: 42,
    donation: 43,
  }
  return map[n] ?? 0
}

import { revalidatePath } from 'next/cache'

export const importSplitwiseCsvProcedure = baseProcedure
  .input(
    z.object({
      csvContent: z.string().min(1),
      groupId: z.string().optional(),
      groupName: z.string().optional(),
      syncMode: z.enum(['skip', 'replace']).default('skip'),
    }),
  )
  .mutation(async ({ input }) => {
    const parsed = parseSplitwiseCsv(input.csvContent)

    let targetGroupId = input.groupId
    let targetGroupName = input.groupName?.trim() || 'Imported Splitwise Group'
    let groupCurrencyCode = parsed.primaryCurrencyCode

    const participantIdByName = new Map<string, string>()
    let existingGroup: any = null

    if (targetGroupId) {
      existingGroup = await prisma.group.findUnique({
        where: { id: targetGroupId },
        include: {
          participants: true,
          expenses: {
            select: {
              id: true,
              title: true,
              amount: true,
              expenseDate: true,
              paidById: true,
              isReimbursement: true,
            },
          },
        },
      })
      if (!existingGroup) {
        throw new Error(`Group not found: ${targetGroupId}`)
      }
      targetGroupName = existingGroup.name
      groupCurrencyCode =
        existingGroup.currencyCode ||
        existingGroup.currency ||
        parsed.primaryCurrencyCode

      for (const p of existingGroup.participants) {
        participantIdByName.set(p.name.trim().toLowerCase(), p.id)
      }

      // Add any missing participants from the CSV
      const missingParticipants = parsed.participants.filter(
        (name) => !participantIdByName.has(name.trim().toLowerCase()),
      )
      if (missingParticipants.length > 0) {
        const newParticipants = missingParticipants.map((name) => {
          const id = randomId()
          participantIdByName.set(name.trim().toLowerCase(), id)
          return { id, name, groupId: targetGroupId! }
        })
        await prisma.participant.createMany({ data: newParticipants })
      }

      if (input.syncMode === 'replace') {
        const existingExpenseIds = existingGroup.expenses.map(
          (e: { id: string }) => e.id,
        )
        if (existingExpenseIds.length > 0) {
          await prisma.expenseDocument.deleteMany({
            where: { expenseId: { in: existingExpenseIds } },
          })
          await prisma.expensePaidFor.deleteMany({
            where: { expenseId: { in: existingExpenseIds } },
          })
          await prisma.expense.deleteMany({
            where: { id: { in: existingExpenseIds } },
          })
        }
      }
    } else {
      targetGroupId = randomId()
      const isSupportedCode = (
        supportedCurrencyCodes as readonly string[]
      ).includes(groupCurrencyCode)
      const symbol =
        currencySymbolMap[groupCurrencyCode] || groupCurrencyCode || '£'

      const newParticipants = parsed.participants.map((name) => {
        const id = randomId()
        participantIdByName.set(name.trim().toLowerCase(), id)
        return { id, name }
      })

      await prisma.group.create({
        data: {
          id: targetGroupId,
          name: targetGroupName,
          information: 'Imported from Splitwise CSV',
          currency: symbol,
          currencyCode: isSupportedCode ? groupCurrencyCode : null,
          participants: {
            createMany: {
              data: newParticipants,
            },
          },
        },
      })
    }

    // Build lookup tally of existing expenses if in 'skip' mode
    let skippedCount = 0
    const existingExpenseTally = new Map<string, number>()
    if (targetGroupId && input.syncMode === 'skip' && existingGroup) {
      for (const exp of existingGroup.expenses) {
        const dateStr = exp.expenseDate.toISOString().slice(0, 10)
        const key = `${dateStr}|${exp.title.trim().toLowerCase()}|${exp.amount}|${exp.paidById}|${exp.isReimbursement}`
        existingExpenseTally.set(key, (existingExpenseTally.get(key) ?? 0) + 1)
      }
    }

    // Prepare expenses and ExpensePaidFor rows
    const expensesData = []
    const paidForData = []

    for (const exp of parsed.expenses) {
      const paidById = participantIdByName.get(exp.paidBy.trim().toLowerCase())
      if (!paidById) continue

      if (targetGroupId && input.syncMode === 'skip') {
        const key = `${exp.date}|${exp.title.trim().toLowerCase()}|${exp.amount}|${paidById}|${exp.isReimbursement}`
        const count = existingExpenseTally.get(key) ?? 0
        if (count > 0) {
          existingExpenseTally.set(key, count - 1)
          skippedCount++
          continue
        }
      }

      const expenseId = randomId()
      const isForeignCurrency = exp.currencyCode !== groupCurrencyCode

      expensesData.push({
        id: expenseId,
        groupId: targetGroupId,
        expenseDate: new Date(`${exp.date}T12:00:00Z`),
        title: exp.title,
        categoryId: mapCategoryNameToId(exp.categoryName, exp.isReimbursement),
        amount: exp.amount,
        originalAmount: isForeignCurrency ? exp.amount : null,
        originalCurrency: isForeignCurrency ? exp.currencyCode : null,
        paidById,
        isReimbursement: exp.isReimbursement,
        splitMode: SplitMode.BY_AMOUNT,
      })

      for (const pf of exp.paidFor) {
        const participantId = participantIdByName.get(
          pf.participantName.trim().toLowerCase(),
        )
        if (participantId && pf.shares > 0) {
          paidForData.push({
            expenseId,
            participantId,
            shares: pf.shares,
          })
        }
      }
    }

    if (expensesData.length > 0) {
      await prisma.$transaction([
        prisma.expense.createMany({ data: expensesData }),
        prisma.expensePaidFor.createMany({ data: paidForData }),
      ])
    }

    if (targetGroupId) {
      revalidatePath(`/groups/${targetGroupId}`)
      revalidatePath(`/groups/${targetGroupId}/expenses`)
      revalidatePath(`/groups/${targetGroupId}/balances`)
    }

    // Find "Jek Tan" participant ID if present so the client can auto-select activeUser
    const jekParticipantId =
      participantIdByName.get('jek tan') ??
      participantIdByName.get('jek') ??
      null

    return {
      groupId: targetGroupId,
      groupName: targetGroupName,
      importedExpensesCount: expensesData.length,
      skippedExpensesCount: skippedCount,
      replacedExpensesCount:
        input.syncMode === 'replace' ? (existingGroup?.expenses.length ?? 0) : 0,
      participantsCount: parsed.participants.length,
      jekParticipantId,
      syncMode: input.syncMode,
    }
  })
