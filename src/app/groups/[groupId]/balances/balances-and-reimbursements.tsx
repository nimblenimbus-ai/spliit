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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  const tSettings = useTranslations('GroupForm.Settings')

  const [activeUserId, setActiveUserId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined' && group) {
      const stored = localStorage.getItem(`${groupId}-activeUser`)
      if (!stored || stored === 'None') {
        setActiveUserId('None')
      } else {
        const matchingParticipant = group.participants.find(
          (p) => p.id === stored || p.name === stored,
        )
        if (matchingParticipant) {
          setActiveUserId(matchingParticipant.id)
          if (stored !== matchingParticipant.id) {
            localStorage.setItem(`${groupId}-activeUser`, matchingParticipant.id)
          }
        } else {
          setActiveUserId('None')
        }
      }
    }
  }, [groupId, group])

  const handleActiveUserChange = (value: string) => {
    setActiveUserId(value)
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${groupId}-activeUser`, value)
    }
  }

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
          <CardTitle>{tSettings('title')}</CardTitle>
          <CardDescription>{tSettings('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="active-user-select">
                {tSettings('ActiveUserField.label')}
              </Label>
              <Select
                value={activeUserId ?? undefined}
                onValueChange={handleActiveUserChange}
                disabled={isLoading}
              >
                <SelectTrigger id="active-user-select">
                  <SelectValue
                    placeholder={tSettings(
                      'ActiveUserField.placeholder',
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="None">
                    {tSettings('ActiveUserField.none')}
                  </SelectItem>
                  {group?.participants
                    .filter((item) => item.name.length > 0)
                    .map((participant) => (
                      <SelectItem key={participant.id} value={participant.id}>
                        {participant.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[0.8rem] text-muted-foreground">
                {tSettings('ActiveUserField.description')}
              </p>
            </div>
            <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
              <div className="space-y-0.5 pr-4">
                <Label
                  htmlFor="simplify-group-debts"
                  className="text-sm font-medium cursor-pointer"
                >
                  Simplify group debts
                </Label>
                <p className="text-[0.8rem] text-muted-foreground">
                  Automatically combine debts across members to reduce the
                  total number of repayments.
                </p>
              </div>
              <Switch
                id="simplify-group-debts"
                data-testid="simplify-debts-toggle"
                checked={optimisticSimplifyDebts}
                onCheckedChange={handleToggleSimplifyDebts}
                disabled={isLoading}
              />
            </div>
          </div>
        </CardContent>
      </Card>
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
        <CardHeader>
          <CardTitle>{t('Reimbursements.title')}</CardTitle>
          <CardDescription>
            {optimisticSimplifyDebts
              ? t('Reimbursements.description')
              : 'Showing direct pairwise debts between members without cross-settling across third parties.'}
          </CardDescription>
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
