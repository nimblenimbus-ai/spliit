'use client'

import { moveExpenseToGroup } from '@/app/groups/[groupId]/expenses/actions'
import {
  getRecentGroups,
  RecentGroups,
} from '@/app/groups/recent-groups-helpers'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { trpc } from '@/trpc/client'
import { AppRouterOutput } from '@/trpc/routers/_app'
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Check,
  Loader2,
  Search,
  UserPlus,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

type Group = NonNullable<AppRouterOutput['groups']['get']['group']>
type Expense = NonNullable<AppRouterOutput['groups']['expenses']['get']['expense']>

type Props = {
  sourceGroup: Group
  expense: Expense
}

export function MoveExpenseDialog({ sourceGroup, expense }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const utils = trpc.useUtils()

  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'select-group' | 'map-participants'>(
    'select-group',
  )
  const [candidateGroups, setCandidateGroups] = useState<RecentGroups>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [targetGroupId, setTargetGroupId] = useState<string>('')
  const [participantMapping, setParticipantMapping] = useState<
    Record<string, string>
  >({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load candidate groups from localStorage when modal opens
  useEffect(() => {
    if (open) {
      const recent = getRecentGroups().filter((g) => g.id !== sourceGroup.id)
      setCandidateGroups(recent)
      setStep('select-group')
      setSearchQuery('')
      setTargetGroupId('')
      setParticipantMapping({})
      setError(null)
    }
  }, [open, sourceGroup.id])

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return candidateGroups
    return candidateGroups.filter((g) => g.name.toLowerCase().includes(q))
  }, [candidateGroups, searchQuery])

  // Fetch destination group details & participants once chosen
  const { data: targetGroupData, isLoading: loadingTargetGroup } =
    trpc.groups.get.useQuery(
      { groupId: targetGroupId },
      { enabled: open && Boolean(targetGroupId) },
    )
  const targetGroup = targetGroupData?.group

  const sourceParticipantById = useMemo(() => {
    return new Map(sourceGroup.participants.map((p) => [p.id, p]))
  }, [sourceGroup.participants])

  const payerParticipant = useMemo(() => {
    return (
      sourceParticipantById.get(expense.paidById) ?? {
        id: expense.paidById,
        name: 'Unknown Payer',
        groupId: sourceGroup.id,
      }
    )
  }, [sourceParticipantById, expense.paidById, sourceGroup.id])

  const consumerParticipants = useMemo(() => {
    return expense.paidFor.map((pf) => {
      const p = sourceParticipantById.get(pf.participantId)
      return {
        id: pf.participantId,
        name: p?.name ?? 'Unknown Participant',
        shares: pf.shares,
      }
    })
  }, [expense.paidFor, sourceParticipantById])

  const allInvolvedSourceIds = useMemo(() => {
    return Array.from(
      new Set([
        expense.paidById,
        ...expense.paidFor.map((pf) => pf.participantId),
      ]),
    )
  }, [expense.paidById, expense.paidFor])

  // Auto-populate participant mapping when targetGroup loads
  useEffect(() => {
    if (!targetGroup) return

    const initialMapping: Record<string, string> = {}
    for (const sourceId of allInvolvedSourceIds) {
      const sourceP = sourceParticipantById.get(sourceId)
      const sourceName = sourceP?.name?.trim() ?? ''

      const matchedTarget = targetGroup.participants.find(
        (tp) => tp.name.trim().toLowerCase() === sourceName.toLowerCase(),
      )

      if (matchedTarget) {
        initialMapping[sourceId] = matchedTarget.id
      } else if (sourceName) {
        // Default to creating the missing participant in the target group
        initialMapping[sourceId] = `__create__:${sourceName}`
      }
    }
    setParticipantMapping(initialMapping)
  }, [targetGroup, allInvolvedSourceIds, sourceParticipantById])

  const allMapped = useMemo(() => {
    if (allInvolvedSourceIds.length === 0) return false
    return allInvolvedSourceIds.every((id) =>
      Boolean(participantMapping[id]?.trim()),
    )
  }, [allInvolvedSourceIds, participantMapping])

  const handleConfirmMove = async () => {
    if (!targetGroupId || !allMapped) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await moveExpenseToGroup({
        expenseId: expense.id,
        sourceGroupId: sourceGroup.id,
        targetGroupId,
        participantMapping,
      })

      await Promise.all([
        utils.groups.expenses.invalidate(),
        utils.groups.balances.invalidate(),
        utils.groups.stats.invalidate(),
        utils.groups.get.invalidate(),
      ])

      toast({
        title: `Expense moved to ${res.targetGroupName}`,
        description: `"${expense.title}" has been transferred to "${res.targetGroupName}".`,
      })

      setOpen(false)
      router.push(`/groups/${sourceGroup.id}/expenses`)
      router.refresh()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to move expense. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const renderMappingSelect = (sourceId: string, sourceName: string) => {
    const currentValue = participantMapping[sourceId] ?? ''
    const createOptionValue = `__create__:${sourceName}`

    return (
      <Select
        value={currentValue}
        onValueChange={(value) => {
          setParticipantMapping((prev) => ({
            ...prev,
            [sourceId]: value,
          }))
          setError(null)
        }}
        disabled={submitting}
      >
        <SelectTrigger className="w-full sm:w-[240px]">
          <SelectValue placeholder="Select target participant…" />
        </SelectTrigger>
        <SelectContent>
          {targetGroup?.participants.map((tp) => (
            <SelectItem key={tp.id} value={tp.id}>
              {tp.name}
            </SelectItem>
          ))}
          <SelectItem
            value={createOptionValue}
            className="text-primary font-medium"
          >
            <span className="inline-flex items-center gap-1.5">
              <UserPlus className="w-3.5 h-3.5" />+ Create new participant &ldquo;
              {sourceName}&rdquo;
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
        >
          <ArrowRightLeft className="w-4 h-4 mr-2" />
          Move to another group
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-primary" />
            Move Expense to Another Group
          </DialogTitle>
          <DialogDescription>
            {step === 'select-group'
              ? `Step 1 of 2: Choose the destination group for "${expense.title}".`
              : `Step 2 of 2: Map the payer and split participants to "${targetGroup?.name ?? 'destination group'}".`}
          </DialogDescription>
        </DialogHeader>

        {step === 'select-group' ? (
          <div className="space-y-4 py-2">
            {candidateGroups.length === 0 ? (
              <div className="rounded-md border p-4 text-sm text-muted-foreground space-y-2">
                <p>No other saved groups found in your browser.</p>
                <p>
                  Visit another group or import your groups via Sync Code on the
                  Groups page first.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="search-target-group">
                    Destination Group ({candidateGroups.length} available)
                  </Label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="search-target-group"
                      placeholder="Search groups by name…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 text-base"
                    />
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto rounded-md border divide-y">
                  {filteredGroups.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground text-center">
                      No matching groups found.
                    </p>
                  ) : (
                    filteredGroups.map((g) => {
                      const isSelected = targetGroupId === g.id
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setTargetGroupId(g.id)}
                          className={`w-full flex items-center justify-between px-3 py-2.5 text-sm text-left transition-colors hover:bg-accent cursor-pointer ${
                            isSelected
                              ? 'bg-primary/10 font-semibold text-primary'
                              : ''
                          }`}
                        >
                          <span className="truncate">{g.name}</span>
                          {isSelected && (
                            <Check className="w-4 h-4 text-primary flex-shrink-0" />
                          )}
                        </button>
                      )
                    })
                  )}
                </div>
              </>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!targetGroupId}
                onClick={() => {
                  setError(null)
                  setStep('map-participants')
                }}
              >
                Next: Map Participants
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {loadingTargetGroup || !targetGroup ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading participants for destination group…
              </div>
            ) : (
              <div className="space-y-4">
                {/* Original Payer Mapping */}
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Original Payer (Paid By)
                  </Label>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border p-3 bg-muted/20">
                    <div className="text-sm font-medium truncate">
                      {payerParticipant.name}
                    </div>
                    {renderMappingSelect(
                      payerParticipant.id,
                      payerParticipant.name,
                    )}
                  </div>
                </div>

                {/* Split Consumers Mapping */}
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Split Consumers (Paid For — {consumerParticipants.length})
                  </Label>
                  <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                    {consumerParticipants.map((consumer) => (
                      <div
                        key={consumer.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3"
                      >
                        <div className="text-sm">
                          <span className="font-medium">{consumer.name}</span>
                          {consumer.id === payerParticipant.id && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (also payer)
                            </span>
                          )}
                        </div>
                        {renderMappingSelect(consumer.id, consumer.name)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive font-medium">{error}</p>
            )}

            <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => {
                  setError(null)
                  setStep('select-group')
                }}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={submitting}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={
                    submitting || loadingTargetGroup || !targetGroup || !allMapped
                  }
                  onClick={handleConfirmMove}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Moving…
                    </>
                  ) : (
                    <>
                      <ArrowRightLeft className="w-4 h-4 mr-2" />
                      Confirm Move
                    </>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
