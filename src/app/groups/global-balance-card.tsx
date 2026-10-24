'use client'

import { CounterpartySummary } from '@/app/actions/cross-group-balances'
import { CounterpartyBreakdownDrawer } from '@/components/CounterpartyBreakdownDrawer'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { MAX_GROUPS_PER_QUERY } from '@/lib/group-query-limits'
import { cn, formatCurrency } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { ChevronRight, RefreshCw, User } from 'lucide-react'

import { useLocale, useTranslations } from 'next-intl'
import {
  getArchivedGroups,
  getRecentGroups,
  RecentGroups,
} from '@/app/groups/recent-groups-helpers'
import { useEffect, useMemo, useState } from 'react'

export function GlobalBalanceCard({
  groups: propGroups,
  archivedGroupIds: propArchivedGroupIds,
  currentGroupId,
  initialPerspective,
}: {
  groups?: RecentGroups
  archivedGroupIds?: string[]
  currentGroupId?: string
  initialPerspective?: string
} = {}) {
  const [mounted, setMounted] = useState(false)
  const [storedGroups, setStoredGroups] = useState<RecentGroups>([])
  const [storedArchived, setStoredArchived] = useState<string[]>([])

  useEffect(() => {
    setMounted(true)
    if (!propGroups && typeof window !== 'undefined') {
      setStoredGroups(getRecentGroups())
    }
    if (!propArchivedGroupIds && typeof window !== 'undefined') {
      setStoredArchived(getArchivedGroups())
    }
  }, [propGroups, propArchivedGroupIds])

  const effectiveGroups = propGroups ?? storedGroups
  const effectiveArchived = propArchivedGroupIds ?? storedArchived

  const activeGroupIds = useMemo(() => {
    const archivedSet = new Set(effectiveArchived)
    let list = effectiveGroups
      .filter((g) => !archivedSet.has(g.id))
      .map((g) => g.id)

    if (
      currentGroupId &&
      !list.includes(currentGroupId) &&
      !archivedSet.has(currentGroupId)
    ) {
      list = [currentGroupId, ...list]
    }

    return list.slice(0, MAX_GROUPS_PER_QUERY)
  }, [effectiveGroups, effectiveArchived, currentGroupId])

  if (!mounted && !propGroups) return null
  if (activeGroupIds.length === 0) return null

  return (
    <GlobalBalanceCard_
      activeGroupIds={activeGroupIds}
      initialPerspective={initialPerspective}
    />
  )
}

function GlobalBalanceCard_({
  activeGroupIds,
  initialPerspective,
}: {
  activeGroupIds: string[]
  initialPerspective?: string
}) {
  const locale = useLocale()
  const t = useTranslations('Groups.GlobalBalance')

  const [selectedPerspective, setSelectedPerspective] = useState<string | null>(null)
  const [selectedCounterparty, setSelectedCounterparty] =
    useState<CounterpartySummary | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [showSettled, setShowSettled] = useState(false)

  // Load persisted perspective on mount
  useEffect(() => {
    const saved = localStorage.getItem('spliit-perspective-user')
    if (saved) {
      setSelectedPerspective(saved)
    } else if (initialPerspective) {
      setSelectedPerspective(initialPerspective)
    }
  }, [initialPerspective])

  const { data, isLoading, isError, refetch } =
    trpc.groups.balances.crossGroup.useQuery(
      {
        activeGroupIds,
        selectedName: selectedPerspective ?? undefined,
      },
      {
        enabled: activeGroupIds.length > 0,
      },
    )

  // Initialize selected perspective once data returns
  useEffect(() => {
    if (data?.selectedName && !selectedPerspective) {
      setSelectedPerspective(data.selectedName)
      localStorage.setItem('spliit-perspective-user', data.selectedName)
    }
  }, [data?.selectedName, selectedPerspective])

  const handlePerspectiveChange = (name: string) => {
    setSelectedPerspective(name)
    localStorage.setItem('spliit-perspective-user', name)
  }

  // Keep drawer's counterparty synchronized if query updates
  const activeDrawerCounterparty = useMemo(() => {
    if (!selectedCounterparty || !data) return null
    return (
      data.counterparties.find(
        (cp) => cp.normalizedName === selectedCounterparty.normalizedName,
      ) ?? selectedCounterparty
    )
  }, [selectedCounterparty, data])

  const unsettledCounterparties = useMemo(() => {
    if (!data) return []
    return data.counterparties.filter((cp) => cp.netAmount !== 0)
  }, [data])

  const settledCounterparties = useMemo(() => {
    if (!data) return []
    return data.counterparties.filter((cp) => cp.netAmount === 0)
  }, [data])

  const displayedCounterparties = useMemo(() => {
    if (!data) return []
    return showSettled ? data.counterparties : unsettledCounterparties
  }, [data, showSettled, unsettledCounterparties])


  if (isError) {
    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>{t('loadError')}</p>
          <Button variant="secondary" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (isLoading || !data) {
    return (
      <Card className="mb-4">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3">
          <div className="space-y-1">
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </div>
          <Skeleton className="h-9 w-[160px]" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <div className="space-y-2 pt-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    )
  }

  const isSettledUp =
    data.totalNetByCurrency.length === 0 ||
    data.totalNetByCurrency.every(({ amount }) => amount === 0)

  return (
    <>
      <Card className="mb-4">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3">
          <div>
            <CardTitle className="text-lg">
              {data.selectedName ? `${data.selectedName}'s Balance` : t('title')}
            </CardTitle>
            <CardDescription>
              Net breakdown across {activeGroupIds.length}{' '}
              {activeGroupIds.length === 1 ? 'active group' : 'active groups'}
            </CardDescription>
          </div>

          {data.uniqueParticipants.length > 0 && (
            <div className="flex items-center gap-2">
              <Select
                value={data.selectedName}
                onValueChange={handlePerspectiveChange}
              >
                <SelectTrigger className="w-full sm:w-[180px] h-9 text-xs">
                  <User className="h-3.5 w-3.5 mr-1.5 shrink-0 opacity-70" />
                  <SelectValue placeholder="Select participant" />
                </SelectTrigger>
                <SelectContent align="end">
                  {data.uniqueParticipants.map((p) => (
                    <SelectItem key={p.normalizedName} value={p.displayName}>
                      <span className="font-medium">{p.displayName}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        ({p.groupCount} {p.groupCount === 1 ? 'grp' : 'grps'})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Overall Net Balance Section */}
          <div className="bg-muted/30 border border-border/60 rounded-xl p-3.5">
            {isSettledUp ? (
              <p className="text-muted-foreground text-sm font-medium">
                {t('settledUp')}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.totalNetByCurrency.map(({ currency, amount }) => {
                  if (amount === 0) return null
                  const formatted = formatCurrency(
                    currency,
                    Math.abs(amount),
                    locale,
                  )
                  const isOwed = amount > 0
                  return (
                    <li
                      key={currency.code || currency.symbol}
                      className="flex justify-between items-baseline gap-2"
                    >
                      <span className="text-sm font-medium text-muted-foreground">
                        {isOwed ? t('owedToYou') : t('youOwe')} overall
                      </span>
                      <span
                        className={cn(
                          'text-2xl font-black tracking-tight tabular-nums',
                          isOwed
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400',
                        )}
                      >
                        {isOwed ? '+' : '-'}
                        {formatted}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Itemised Counterparties Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Counterparty Breakdown
              </span>

              {settledCounterparties.length > 0 && (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="show-settled"
                    checked={showSettled}
                    onCheckedChange={(checked) => setShowSettled(Boolean(checked))}
                  />
                  <Label
                    htmlFor="show-settled"
                    className="text-xs text-muted-foreground cursor-pointer font-normal select-none hover:text-foreground transition-colors"
                  >
                    Show settled ({settledCounterparties.length})
                  </Label>
                </div>
              )}
            </div>

            {data.counterparties.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">
                No counterparties found in your active groups.
              </p>
            ) : displayedCounterparties.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-border/80 text-center space-y-2 bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  All counterparties are settled up ({settledCounterparties.length}{' '}
                  {settledCounterparties.length === 1 ? 'person' : 'people'}).
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setShowSettled(true)}
                >
                  Show settled participants
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-0.5">
                {displayedCounterparties.map((cp) => {

                  const isOwed = cp.netAmount > 0
                  const isOwing = cp.netAmount < 0
                  const isSettled = cp.netAmount === 0

                  return (
                    <button
                      key={cp.normalizedName}
                      type="button"
                      onClick={() => {
                        setSelectedCounterparty(cp)
                        setIsDrawerOpen(true)
                      }}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl border border-border/60 bg-card hover:bg-accent/60 hover:border-accent transition-all text-left group cursor-pointer shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 border border-primary/20">
                          {(cp.name.trim()[0] || '?').toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                            {cp.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {cp.groupCount}{' '}
                            {cp.groupCount === 1 ? 'shared group' : 'shared groups'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <div
                            className={cn(
                              'text-sm font-bold tabular-nums',
                              isOwing && 'text-red-600 dark:text-red-400',
                              isOwed && 'text-green-600 dark:text-green-400',
                              isSettled && 'text-muted-foreground font-normal',
                            )}
                          >
                            {isOwed && '+'}
                            {isOwing && '-'}
                            {formatCurrency(
                              cp.currency,
                              Math.abs(cp.netAmount),
                              locale,
                            )}
                          </div>
                          <div
                            className={cn(
                              'text-[10px] font-medium',
                              isOwing && 'text-red-600 dark:text-red-400',
                              isOwed && 'text-green-600 dark:text-green-400',
                              isSettled && 'text-muted-foreground',
                            )}
                          >
                            {isOwing
                              ? 'You owe'
                              : isOwed
                                ? 'Owes you'
                                : 'Settled'}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <CounterpartyBreakdownDrawer
        isOpen={isDrawerOpen}
        onOpenChange={setIsDrawerOpen}
        counterparty={activeDrawerCounterparty}
        activeUserName={data.selectedName}
      />
    </>
  )
}
