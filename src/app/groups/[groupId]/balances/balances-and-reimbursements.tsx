'use client'

import { BalancesList } from '@/app/groups/[groupId]/balances-list'
import { toggleSimplifyDebts } from '@/app/groups/[groupId]/balances/actions'
import { ReimbursementList } from '@/app/groups/[groupId]/reimbursement-list'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TrackPage } from '@/lib/analytics/track-page'
import { getCurrencyFromGroup } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { useTranslations } from 'next-intl'
import { Fragment, useEffect, useState } from 'react'
import { match } from 'ts-pattern'
import { useCurrentGroup } from '../current-group-context'

export default function BalancesAndReimbursements() {
  const utils = trpc.useUtils()
  const { groupId, group } = useCurrentGroup()
  const { data: balancesData, isLoading: balancesAreLoading } =
    trpc.groups.balances.list.useQuery({
      groupId,
    })
  const t = useTranslations('Balances')

  const serverSimplifyDebts =
    balancesData?.simplifyDebts ?? group?.simplifyDebts ?? true
  const [optimisticSimplifyDebts, setOptimisticSimplifyDebts] =
    useState<boolean>(serverSimplifyDebts)

  useEffect(() => {
    setOptimisticSimplifyDebts(serverSimplifyDebts)
  }, [serverSimplifyDebts])

  useEffect(() => {
    // Until we use tRPC more widely and can invalidate the cache on expense
    // update, it's easier and safer to invalidate the cache on page load.
    utils.groups.balances.invalidate()
  }, [utils])

  const handleToggleSimplifyDebts = async (enabled: boolean) => {
    const previous = optimisticSimplifyDebts
    setOptimisticSimplifyDebts(enabled)

    // Optimistically update the tRPC cache as well
    utils.groups.balances.list.setData({ groupId }, (old) => {
      if (!old) return old
      return {
        ...old,
        simplifyDebts: enabled,
        reimbursements: enabled
          ? old.simplifiedReimbursements
          : old.pairwiseReimbursements,
      }
    })

    try {
      const activeUserId =
        typeof window !== 'undefined'
          ? localStorage.getItem(`${groupId}-activeUser`) ?? undefined
          : undefined
      await toggleSimplifyDebts(
        groupId,
        enabled,
        activeUserId && activeUserId !== 'None' ? activeUserId : undefined,
      )
      await Promise.all([
        utils.groups.get.invalidate({ groupId }),
        utils.groups.getDetails.invalidate({ groupId }),
        utils.groups.balances.list.invalidate({ groupId }),
      ])
    } catch {
      setOptimisticSimplifyDebts(previous)
      await utils.groups.balances.list.invalidate({ groupId })
    }
  }

  const isLoading = balancesAreLoading || !balancesData || !group

  const displayedReimbursements = balancesData
    ? optimisticSimplifyDebts
      ? (balancesData.simplifiedReimbursements ?? balancesData.reimbursements)
      : (balancesData.pairwiseReimbursements ?? balancesData.reimbursements)
    : []

  return (
    <>
      <TrackPage path={`/groups/${groupId}/balances`} />
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <BalancesLoading participantCount={group?.participants.length} />
          ) : (
            <BalancesList
              balances={balancesData.balances}
              participants={group?.participants}
              currency={getCurrencyFromGroup(group)}
            />
          )}
        </CardContent>
      </Card>
      <Card className="mb-4">
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>{t('Reimbursements.title')}</CardTitle>
            <CardDescription>
              {optimisticSimplifyDebts
                ? t('Reimbursements.description')
                : 'Showing direct pairwise debts between members without cross-settling across third parties.'}
            </CardDescription>
          </div>
          <div className="flex items-center space-x-2 pt-1">
            <Switch
              id="simplify-group-debts"
              data-testid="simplify-debts-toggle"
              checked={optimisticSimplifyDebts}
              onCheckedChange={handleToggleSimplifyDebts}
              disabled={isLoading}
            />
            <Label
              htmlFor="simplify-group-debts"
              className="text-sm font-medium cursor-pointer whitespace-nowrap"
            >
              Simplify group debts
            </Label>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ReimbursementsLoading
              participantCount={group?.participants.length}
            />
          ) : (
            <ReimbursementList
              reimbursements={displayedReimbursements}
              participants={group?.participants}
              currency={getCurrencyFromGroup(group)}
              groupId={groupId}
            />
          )}
        </CardContent>
      </Card>
    </>
  )
}

const ReimbursementsLoading = ({
  participantCount = 3,
}: {
  participantCount?: number
}) => {
  return (
    <div className="flex flex-col">
      {Array(participantCount - 1)
        .fill(undefined)
        .map((_, index) => (
          <div key={index} className="flex justify-between py-5">
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
    </div>
  )
}

const BalancesLoading = ({
  participantCount = 3,
}: {
  participantCount?: number
}) => {
  const barWidth = (index: number) =>
    match(index % 3)
      .with(0, () => 'w-1/3')
      .with(1, () => 'w-2/3')
      .otherwise(() => 'w-full')

  return (
    <div className="grid grid-cols-2 py-1 gap-y-2">
      {Array(participantCount)
        .fill(undefined)
        .map((_, index) =>
          index % 2 === 0 ? (
            <Fragment key={index}>
              <div className="flex items-center justify-end pr-2">
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="self-start">
                <Skeleton className={`h-7 ${barWidth(index)} rounded-l-none`} />
              </div>
            </Fragment>
          ) : (
            <Fragment key={index}>
              <div className="flex items-center justify-end">
                <Skeleton className={`h-7 ${barWidth(index)} rounded-r-none`} />
              </div>
              <div className="flex items-center pl-2">
                <Skeleton className="h-3 w-16" />
              </div>
            </Fragment>
          ),
        )}
    </div>
  )
}
