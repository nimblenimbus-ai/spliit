'use client'

import {
  getRecentGroups,
  RecentGroups,
  saveRecentGroup,
  starGroup,
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { parseSplitwiseCsv } from '@/lib/splitwise-csv'
import { cn } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { FileUp, Loader2, RefreshCw, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

type Props = {
  /** If provided, imports expenses into this existing group instead of creating a new group. */
  groupId?: string
  /** Optional callback after import completes. */
  onSuccess?: () => void
  /** Render as a compact icon button (e.g. inside a group's Expenses header) */
  iconOnly?: boolean
  /** Custom label for the button trigger */
  triggerLabel?: string
}

export function ImportSplitwiseCsvButton({
  groupId,
  onSuccess,
  iconOnly = false,
  triggerLabel = 'Import Groups via Splitwise CSV',
}: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [open, setOpen] = useState(false)
  const [recentGroups, setRecentGroups] = useState<RecentGroups>([])
  const [destinationMode, setDestinationMode] = useState<'create' | 'existing'>(
    groupId ? 'existing' : 'create',
  )
  const [selectedGroupId, setSelectedGroupId] = useState<string>(groupId ?? '')
  const [groupName, setGroupName] = useState('')
  const [csvContent, setCsvContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [syncMode, setSyncMode] = useState<'skip' | 'replace'>('skip')
  const [preview, setPreview] = useState<{
    expensesCount: number
    participants: string[]
    currency: string
  } | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const importMutation = trpc.groups.importSplitwiseCsv.useMutation()

  const effectiveGroupId = groupId || (destinationMode === 'existing' ? selectedGroupId : undefined)

  useEffect(() => {
    if (open) {
      const groups = getRecentGroups()
      setRecentGroups(groups)
      if (groupId) {
        setDestinationMode('existing')
        setSelectedGroupId(groupId)
      } else {
        setDestinationMode('create')
        setSelectedGroupId('')
      }
      setSyncMode('skip')
    }
  }, [open, groupId])

  const resetState = () => {
    setGroupName('')
    setCsvContent('')
    setFileName('')
    setPreview(null)
    setParseError(null)
    setSyncMode('skip')
    if (!groupId) {
      setDestinationMode('create')
      setSelectedGroupId('')
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setParseError(null)

    // Suggest default group name from filename if creating a new group
    if (!effectiveGroupId && !groupName) {
      const cleaned = file.name
        .replace(/\.csv$/i, '')
        .replace(/_?\d{4}-\d{2}-\d{2}(_export)?$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim()
      if (cleaned) {
        setGroupName(
          cleaned.replace(/\b\w/g, (char) => char.toUpperCase()),
        )
      }
    }

    try {
      const text = await file.text()
      const parsed = parseSplitwiseCsv(text)
      setCsvContent(text)
      setPreview({
        expensesCount: parsed.expenses.length,
        participants: parsed.participants,
        currency: parsed.primaryCurrencyCode,
      })
    } catch (err) {
      setCsvContent('')
      setPreview(null)
      setParseError(
        err instanceof Error ? err.message : 'Failed to parse Splitwise CSV.',
      )
    }
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!csvContent) return

    if (destinationMode === 'existing' && !effectiveGroupId) {
      setParseError('Please select a destination group.')
      return
    }

    try {
      const result = await importMutation.mutateAsync({
        csvContent,
        groupId: effectiveGroupId,
        groupName: effectiveGroupId ? undefined : groupName.trim() || 'Splitwise Import',
        syncMode,
      })

      saveRecentGroup({ id: result.groupId, name: result.groupName })
      if (!effectiveGroupId) {
        starGroup(result.groupId)
      }
      if (result.jekParticipantId) {
        localStorage.setItem(
          `${result.groupId}-activeUser`,
          result.jekParticipantId,
        )
      }

      await utils.groups.invalidate()

      if (result.syncMode === 'replace') {
        toast({
          title: 'Group Expenses Replaced!',
          description: `Replaced all expenses in "${result.groupName}" with ${result.importedExpensesCount} expenses from Splitwise.`,
        })
      } else if (result.skippedExpensesCount > 0) {
        toast({
          title: 'Splitwise CSV Imported!',
          description: `Added ${result.importedExpensesCount} new expenses to "${result.groupName}" (${result.skippedExpensesCount} duplicates skipped).`,
        })
      } else {
        toast({
          title: 'Splitwise CSV Imported!',
          description: `Imported ${result.importedExpensesCount} expenses (${result.participantsCount} participants) into "${result.groupName}".`,
        })
      }

      setOpen(false)
      resetState()
      onSuccess?.()

      if (!groupId) {
        router.push(`/groups/${result.groupId}/expenses`)
      }
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'Failed to import Splitwise CSV.',
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetState()
      }}
    >
      <DialogTrigger asChild>
        {iconOnly ? (
          <Button
            variant="secondary"
            size="icon"
            title="Import from Splitwise CSV"
          >
            <Upload className="w-4 h-4" />
          </Button>
        ) : (
          <Button variant="outline">
            <FileUp className="w-4 h-4 mr-2" />
            {triggerLabel}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleImport} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {effectiveGroupId
                ? 'Import Splitwise CSV into Group'
                : 'Import Group from Splitwise CSV'}
            </DialogTitle>
            <DialogDescription>
              {effectiveGroupId
                ? 'Upload a Splitwise spreadsheet (.csv) export to update this group with latest expenses and participants.'
                : 'Upload a Splitwise spreadsheet (.csv) export to create a new group or update an existing one.'}
            </DialogDescription>
          </DialogHeader>

          {/* Group destination selection when launched without preset groupId */}
          {!groupId && recentGroups.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Destination</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={destinationMode === 'create' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDestinationMode('create')}
                >
                  Create New Group
                </Button>
                <Button
                  type="button"
                  variant={destinationMode === 'existing' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setDestinationMode('existing')}
                >
                  Update Existing Group
                </Button>
              </div>

              {destinationMode === 'existing' && (
                <div className="pt-2">
                  <Label htmlFor="select-existing-group">Select Group</Label>
                  <Select
                    value={selectedGroupId}
                    onValueChange={(val) => {
                      setSelectedGroupId(val)
                      setParseError(null)
                    }}
                  >
                    <SelectTrigger id="select-existing-group" className="w-full">
                      <SelectValue placeholder="Choose an existing group…" />
                    </SelectTrigger>
                    <SelectContent>
                      {recentGroups.map((rg) => (
                        <SelectItem key={rg.id} value={rg.id}>
                          {rg.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {!effectiveGroupId && (
            <div className="space-y-2">
              <Label htmlFor="splitwise-group-name">Group Name</Label>
              <Input
                id="splitwise-group-name"
                type="text"
                placeholder="e.g. Ski Trip 2027"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                disabled={importMutation.isPending}
                required
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="splitwise-csv-file">Splitwise CSV File</Label>
            <Input
              id="splitwise-csv-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              disabled={importMutation.isPending}
              required
            />
          </div>

          {preview && (
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <p className="font-medium">
                Ready to import from <span className="underline">{fileName}</span>:
              </p>
              <ul className="list-disc list-inside text-muted-foreground">
                <li>
                  <strong>{preview.expensesCount}</strong> expenses (Currency:{' '}
                  <strong>{preview.currency}</strong>)
                </li>
                <li>
                  <strong>{preview.participants.length}</strong> participants:{' '}
                  {preview.participants.join(', ')}
                </li>
              </ul>
            </div>
          )}

          {/* Decision flow for existing group: Skip vs Replace */}
          {effectiveGroupId && (
            <div className="space-y-2.5 pt-2 border-t">
              <Label className="text-sm font-semibold">
                Decision: Duplicate Handling
              </Label>
              <RadioGroup
                value={syncMode}
                onValueChange={(val) => setSyncMode(val as 'skip' | 'replace')}
                className="gap-2"
              >
                <label
                  htmlFor="sync-skip"
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                    syncMode === 'skip'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <RadioGroupItem value="skip" id="sync-skip" className="mt-0.5" />
                  <div className="space-y-1 text-sm">
                    <div className="font-medium text-foreground">
                      Skip existing expenses{' '}
                      <span className="text-xs text-primary font-semibold">
                        (Recommended)
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Only imports newly added expenses from the CSV. Existing
                      expenses with matching date, title, amount, and payer are
                      kept untouched.
                    </p>
                  </div>
                </label>

                <label
                  htmlFor="sync-replace"
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                    syncMode === 'replace'
                      ? 'border-destructive bg-destructive/5'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <RadioGroupItem
                    value="replace"
                    id="sync-replace"
                    className="mt-0.5"
                  />
                  <div className="space-y-1 text-sm">
                    <div className="font-medium text-destructive">
                      Replace all existing expenses
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Wipes all current expenses in this group and reloads the
                      entire CSV fresh. Best when previous expenses were edited,
                      split differently, or deleted in Splitwise.
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>
          )}

          {parseError && (
            <p className="text-sm text-destructive font-medium">{parseError}</p>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={importMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={effectiveGroupId && syncMode === 'replace' ? 'destructive' : 'default'}
              disabled={
                !csvContent ||
                importMutation.isPending ||
                (destinationMode === 'existing' && !effectiveGroupId)
              }
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : effectiveGroupId ? (
                syncMode === 'replace' ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Replace All Expenses
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Import New Expenses
                  </>
                )
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Create &amp; Import Group
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
