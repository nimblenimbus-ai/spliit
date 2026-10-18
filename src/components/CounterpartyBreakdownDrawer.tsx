'use client'

import { CounterpartySummary } from '@/app/actions/cross-group-balances'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency } from '@/lib/utils'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  CheckCircle2,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from 'lucide-react'
import { useLocale } from 'next-intl'
import Link from 'next/link'
import * as React from 'react'

export type CounterpartyBreakdownDrawerProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  counterparty: CounterpartySummary | null
  activeUserName: string
}

export function CounterpartyBreakdownDrawer({
  isOpen,
  onOpenChange,
  counterparty,
  activeUserName,
}: CounterpartyBreakdownDrawerProps) {
  const locale = useLocale()

  if (!counterparty) {
    return null
  }

  const isOwed = counterparty.netAmount > 0
  const isOwing = counterparty.netAmount < 0
  const isSettled = counterparty.netAmount === 0

  const initial = (counterparty.name.trim()[0] || '?').toUpperCase()

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby="counterparty-breakdown-description"
          className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-background p-6 shadow-2xl outline-none transition ease-in-out duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base select-none shrink-0 border border-primary/20">
                {initial}
              </div>
              <div>
                <DialogPrimitive.Title className="text-lg font-bold tracking-tight text-foreground">
                  {counterparty.name}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description
                  id="counterparty-breakdown-description"
                  className="text-xs text-muted-foreground mt-0.5 line-clamp-1"
                >
                  Between {activeUserName} and {counterparty.name}
                </DialogPrimitive.Description>
              </div>
            </div>

            <DialogPrimitive.Close
              aria-label="Close"
              className="rounded-full p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Aggregate Net Overview Card */}
          <div className="py-4">
            {isOwed && (
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-green-700 dark:text-green-400">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium text-xs uppercase tracking-wider">
                    <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <span>Overall Net: Owes you</span>
                  </div>
                  <span className="text-xl font-extrabold tabular-nums">
                    +
                    {formatCurrency(
                      counterparty.currency,
                      counterparty.netAmount,
                      locale,
                    )}
                  </span>
                </div>
                <p className="text-xs text-green-600/80 dark:text-green-400/80 mt-1">
                  Across all shared unarchived groups, {counterparty.name} owes
                  you in total.
                </p>
              </div>
            )}

            {isOwing && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-700 dark:text-red-400">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium text-xs uppercase tracking-wider">
                    <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
                    <span>Overall Net: You owe</span>
                  </div>
                  <span className="text-xl font-extrabold tabular-nums">
                    -
                    {formatCurrency(
                      counterparty.currency,
                      Math.abs(counterparty.netAmount),
                      locale,
                    )}
                  </span>
                </div>
                <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
                  Across all shared unarchived groups, you owe{' '}
                  {counterparty.name} in total.
                </p>
              </div>
            )}

            {isSettled && (
              <div className="rounded-xl border border-border bg-muted/40 p-4 text-muted-foreground">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium text-xs uppercase tracking-wider">
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                    <span>Overall Net: Settled Up</span>
                  </div>
                  <span className="text-xl font-bold tabular-nums">
                    {formatCurrency(counterparty.currency, 0, locale)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  You and {counterparty.name} are completely square across all
                  shared groups.
                </p>
              </div>
            )}
          </div>

          {/* Group-by-Group Breakdown List */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Shared Groups ({counterparty.groups.length})
              </h3>
              <span className="text-[11px] text-muted-foreground">
                Click group to view ledger
              </span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 pb-4">
              {counterparty.groups.map((group) => {
                const groupOwed = group.amount > 0
                const groupOwing = group.amount < 0
                const groupSettled = group.amount === 0

                return (
                  <Link
                    key={group.groupId}
                    href={`/groups/${group.groupId}`}
                    onClick={() => onOpenChange(false)}
                    className="group flex items-center justify-between p-3.5 rounded-xl border border-border bg-card/60 hover:bg-accent/60 hover:border-accent transition-all duration-150 cursor-pointer shadow-xs"
                  >
                    <div className="min-w-0 pr-3">
                      <div className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors truncate">
                        {group.groupName}
                      </div>
                      <div className="text-xs mt-0.5">
                        {groupOwed && (
                          <span className="text-green-600 dark:text-green-400 font-medium">
                            {counterparty.name} owes you
                          </span>
                        )}
                        {groupOwing && (
                          <span className="text-red-600 dark:text-red-400 font-medium">
                            You owe {counterparty.name}
                          </span>
                        )}
                        {groupSettled && (
                          <span className="text-muted-foreground">
                            Settled up
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          'text-sm font-bold tabular-nums',
                          groupOwed && 'text-green-600 dark:text-green-400',
                          groupOwing && 'text-red-600 dark:text-red-400',
                          groupSettled && 'text-muted-foreground font-normal',
                        )}
                      >
                        {groupOwed && '+'}
                        {groupOwing && '-'}
                        {formatCurrency(
                          group.currency,
                          Math.abs(group.amount),
                          locale,
                        )}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </Link>
                )
              })}

              {counterparty.groups.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No shared active groups found.
                </div>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
