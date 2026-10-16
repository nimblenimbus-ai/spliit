export type ParsedSplitwiseExpense = {
  date: string // YYYY-MM-DD
  title: string
  categoryName: string
  amount: number // in minor units (cents)
  currencyCode: string
  isReimbursement: boolean
  paidBy: string // participant name
  paidFor: { participantName: string; shares: number }[] // shares in cents (BY_AMOUNT)
}

export type ParsedSplitwiseCsvResult = {
  participants: string[]
  primaryCurrencyCode: string
  expenses: ParsedSplitwiseExpense[]
}

/**
 * RFC 4180 compliant CSV parser that handles quoted fields, escaped quotes (""),
 * and newlines inside quotes.
 */
export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  const text = csvText.replace(/^\uFEFF/, '') // Strip UTF-8 BOM if present

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const nextChar = text[i + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        currentField += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        currentRow.push(currentField)
        currentField = ''
      } else if (char === '\r' && nextChar === '\n') {
        currentRow.push(currentField)
        rows.push(currentRow)
        currentRow = []
        currentField = ''
        i++
      } else if (char === '\n' || char === '\r') {
        currentRow.push(currentField)
        rows.push(currentRow)
        currentRow = []
        currentField = ''
      } else {
        currentField += char
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  return rows.filter((row) => row.some((cell) => cell.trim() !== ''))
}

/**
 * Parses a Splitwise CSV export:
 * Header: Date, Description, Category, Cost, Currency, <Participant 1>, <Participant 2>, ...
 */
export function parseSplitwiseCsv(csvText: string): ParsedSplitwiseCsvResult {
  const rows = parseCsvRows(csvText)
  if (rows.length < 2) {
    throw new Error('CSV file is empty or missing expense rows.')
  }

  const header = rows[0].map((h) => h.trim())
  const dateIdx = header.findIndex((h) => /^date$/i.test(h))
  const descIdx = header.findIndex((h) => /^description$/i.test(h))
  const catIdx = header.findIndex((h) => /^category$/i.test(h))
  const costIdx = header.findIndex((h) => /^cost$/i.test(h))
  const currIdx = header.findIndex((h) => /^currency$/i.test(h))

  if (
    dateIdx === -1 ||
    descIdx === -1 ||
    costIdx === -1 ||
    currIdx === -1
  ) {
    throw new Error(
      'Invalid Splitwise CSV header. Expected columns: Date, Description, Category, Cost, Currency, followed by participant names.',
    )
  }

  const firstParticipantIdx = Math.max(dateIdx, descIdx, catIdx, costIdx, currIdx) + 1
  const rawParticipantNames = header.slice(firstParticipantIdx).map((n) => n.trim())
  const participants = rawParticipantNames.filter((n) => n.length > 0)

  if (participants.length === 0) {
    throw new Error('No participant columns found in the Splitwise CSV header.')
  }

  const expenses: ParsedSplitwiseExpense[] = []
  const currencyCounts: Record<string, number> = {}

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const rawDate = (row[dateIdx] ?? '').trim()
    const description = (row[descIdx] ?? '').trim()
    const categoryName = catIdx !== -1 ? (row[catIdx] ?? '').trim() : 'General'
    const rawCost = (row[costIdx] ?? '').trim()
    const currencyCode = (row[currIdx] ?? '').trim().toUpperCase() || 'GBP'

    // Skip summary/total balance rows at the bottom of Splitwise CSVs
    if (
      !rawDate ||
      /^total balance/i.test(description) ||
      !/^\d{4}-\d{2}-\d{2}/.test(rawDate)
    ) {
      continue
    }

    const costCents = Math.round(parseFloat(rawCost) * 100)
    if (!Number.isFinite(costCents) || costCents <= 0) {
      continue
    }

    // Read net balances for each participant in this row
    const nets: { name: string; netCents: number }[] = []
    for (let p = 0; p < participants.length; p++) {
      const cell = (row[firstParticipantIdx + p] ?? '0').trim()
      const val = parseFloat(cell)
      const netCents = Number.isFinite(val) ? Math.round(val * 100) : 0
      nets.push({ name: participants[p], netCents })
    }

    // If everyone has 0 net balance, skip
    if (nets.every((n) => n.netCents === 0)) {
      continue
    }

    currencyCounts[currencyCode] = (currencyCounts[currencyCode] || 0) + 1

    const isReimbursement =
      /^payment$/i.test(categoryName) || /^payment$/i.test(description)

    // Reconstruct paidCents and owedCents from costCents and netCents:
    // In Splitwise CSVs, for single-payer expenses (99.9% of cases):
    // The payer has netCents > 0 (where paid = costCents, owed = costCents - netCents)
    // and non-payers have netCents <= 0 (where paid = 0, owed = -netCents).
    const positiveNets = nets.filter((n) => n.netCents > 0)

    if (positiveNets.length === 0) {
      continue
    }

    if (positiveNets.length === 1) {
      const payer = positiveNets[0]
      const payerOwed = Math.max(0, costCents - payer.netCents)
      const paidFor: { participantName: string; shares: number }[] = []

      if (payerOwed > 0) {
        paidFor.push({ participantName: payer.name, shares: payerOwed })
      }
      for (const n of nets) {
        if (n.name === payer.name) continue
        if (n.netCents < 0) {
          paidFor.push({ participantName: n.name, shares: -n.netCents })
        }
      }

      // Guard: ensure sum of shares equals costCents
      const sumShares = paidFor.reduce((acc, pf) => acc + pf.shares, 0)
      if (paidFor.length > 0 && sumShares !== costCents) {
        paidFor[0].shares += costCents - sumShares
      }

      if (paidFor.length > 0) {
        expenses.push({
          date: rawDate.slice(0, 10),
          title: description || 'Expense',
          categoryName,
          amount: costCents,
          currencyCode,
          isReimbursement,
          paidBy: payer.name,
          paidFor,
        })
      }
    } else {
      // Multi-payer row: split into one expense per creditor against the debtors
      const totalPositive = positiveNets.reduce((s, n) => s + n.netCents, 0)
      const debtors = nets.filter((n) => n.netCents < 0)
      for (let i = 0; i < positiveNets.length; i++) {
        const creditor = positiveNets[i]
        const paidFor: { participantName: string; shares: number }[] = []
        let rem = creditor.netCents
        for (let j = 0; j < debtors.length; j++) {
          const d = debtors[j]
          const share =
            j === debtors.length - 1
              ? rem
              : Math.round((-d.netCents * creditor.netCents) / totalPositive)
          rem -= share
          if (share > 0) {
            paidFor.push({ participantName: d.name, shares: share })
          }
        }
        if (paidFor.length > 0) {
          expenses.push({
            date: rawDate.slice(0, 10),
            title: `${description || 'Expense'} (${creditor.name})`,
            categoryName,
            amount: creditor.netCents,
            currencyCode,
            isReimbursement,
            paidBy: creditor.name,
            paidFor,
          })
        }
      }
    }
  }

  const primaryCurrencyCode =
    Object.entries(currencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'GBP'

  return {
    participants,
    primaryCurrencyCode,
    expenses,
  }
}
