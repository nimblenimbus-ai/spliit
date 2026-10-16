'use client'

import {
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
import { useToast } from '@/components/ui/use-toast'
import { parseSplitwiseCsv } from '@/lib/splitwise-csv'
import { trpc } from '@/trpc/client'
import { FileUp, Loader2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

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
  const [groupName, setGroupName] = useState('')
  const [csvContent, setCsvContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<{
    expensesCount: number
    participants: string[]
    currency: string
  } | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const importMutation = trpc.groups.importSplitwiseCsv.useMutation()

  const resetState = () => {
    setGroupName('')
    setCsvContent('')
    setFileName('')
    setPreview(null)
    setParseError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setParseError(null)

    // Default group name from filename (e.g. "malta-2026_2026-10-16_export.csv" -> "Malta 2026")
    if (!groupId && !groupName) {
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

    try {
      const result = await importMutation.mutateAsync({
        csvContent,
        groupId,
        groupName: groupId ? undefined : groupName.trim() || 'Splitwise Import',
      })

      saveRecentGroup({ id: result.groupId, name: result.groupName })
      if (!groupId) {
        starGroup(result.groupId)
      }
      if (result.jekParticipantId) {
        localStorage.setItem(
          `${result.groupId}-activeUser`,
          result.jekParticipantId,
        )
      }

      await utils.groups.invalidate()

      toast({
        title: 'Splitwise CSV Imported!',
        description: `Imported ${result.importedExpensesCount} expenses (${result.participantsCount} participants) into "${result.groupName}".`,
      })

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
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleImport} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {groupId
                ? 'Import Splitwise CSV into Group'
                : 'Import Group from Splitwise CSV'}
            </DialogTitle>
            <DialogDescription>
              {groupId
                ? 'Upload a Splitwise spreadsheet (.csv) export to add its expenses and any new participants into this group.'
                : 'Upload a Splitwise spreadsheet (.csv) export to create a new group with all participants, categories, currencies, and exact split shares.'}
            </DialogDescription>
          </DialogHeader>

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

          {!groupId && (
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

          {parseError && (
            <p className="text-sm text-destructive font-medium">{parseError}</p>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
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
              disabled={!csvContent || importMutation.isPending}
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  {groupId ? 'Import Expenses' : 'Create & Import Group'}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
