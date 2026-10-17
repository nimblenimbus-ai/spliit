'use client'

import {
  createOrUpdateSyncKey,
  fetchGroupsBySyncKey,
} from '@/app/actions/sync'
import {
  getRecentGroups,
  mergeRecentGroups,
  RecentGroups,
} from '@/app/groups/recent-groups-helpers'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Loader2,
  RefreshCw,
  Share2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const RANDOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateRandomSyncCode(length = 6): string {
  let code = ''
  const array = new Uint32Array(length)
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(array)
    for (let i = 0; i < length; i++) {
      code += RANDOM_CHARS[array[i] % RANDOM_CHARS.length]
    }
  } else {
    for (let i = 0; i < length; i++) {
      code += RANDOM_CHARS[Math.floor(Math.random() * RANDOM_CHARS.length)]
    }
  }
  return code
}

type Props = {
  onSuccess?: () => void
  defaultTab?: 'import' | 'export'
  triggerLabel?: string
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'link'
}

export function SyncGroupsButton({
  onSuccess,
  defaultTab,
  triggerLabel = 'Sync Key',
  variant = 'secondary',
}: Props) {
  const router = useRouter()
  const { toast } = useToast()

  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'import' | 'export'>(
    defaultTab ?? 'import',
  )

  // Local groups state for export
  const [localGroups, setLocalGroups] = useState<RecentGroups>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [exportKeyInput, setExportKeyInput] = useState('')
  const [exportLabel, setExportLabel] = useState('')
  const [exportPending, setExportPending] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [savedSyncKey, setSavedSyncKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Import state
  const [importKeyInput, setImportKeyInput] = useState('')
  const [importPending, setImportPending] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      const groups = getRecentGroups()
      setLocalGroups(groups)
      setSelectedIds(new Set(groups.map((g) => g.id)))
      if (!defaultTab) {
        setActiveTab(groups.length > 0 ? 'export' : 'import')
      } else {
        setActiveTab(defaultTab)
      }
      if (!exportKeyInput) {
        setExportKeyInput(generateRandomSyncCode(6))
      }
      setExportError(null)
      setImportError(null)
      setSavedSyncKey(null)
      setCopied(false)
    }
  }, [open, defaultTab])

  const toggleGroupSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === localGroups.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(localGroups.map((g) => g.id)))
    }
  }

  const handleExportSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setExportError(null)
    setSavedSyncKey(null)

    const trimmedKey = exportKeyInput.trim().toUpperCase()
    if (trimmedKey.length < 2) {
      setExportError('Please enter a Sync Key of at least 2 characters.')
      return
    }
    if (selectedIds.size === 0) {
      setExportError('Please select at least one group to share.')
      return
    }

    // Preserve the order from localGroups
    const orderedIds = localGroups
      .filter((g) => selectedIds.has(g.id))
      .map((g) => g.id)

    setExportPending(true)
    try {
      const res = await createOrUpdateSyncKey(
        trimmedKey,
        orderedIds,
        exportLabel.trim() || undefined,
      )
      setSavedSyncKey(res.syncKey)
      setExportKeyInput(res.syncKey)
      toast({
        title: 'Sync Key Saved',
        description: `Saved ${orderedIds.length} group${orderedIds.length === 1 ? '' : 's'} to Sync Key "${res.syncKey}".`,
      })
    } catch (err) {
      setExportError(
        err instanceof Error
          ? err.message
          : 'Failed to save Sync Key. Please try again.',
      )
    } finally {
      setExportPending(false)
    }
  }

  const handleCopySyncCode = async () => {
    if (!savedSyncKey) return
    try {
      await navigator.clipboard.writeText(savedSyncKey)
      setCopied(true)
      toast({
        title: 'Copied to clipboard',
        description: `Sync Code "${savedSyncKey}" copied to clipboard.`,
      })
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Fallback
    }
  }

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setImportError(null)

    const trimmedKey = importKeyInput.trim().toUpperCase()
    if (!trimmedKey) {
      setImportError('Please enter a Sync Code.')
      return
    }

    setImportPending(true)
    try {
      const result = await fetchGroupsBySyncKey(trimmedKey)
      if (!result.found || result.groups.length === 0) {
        setImportError('Unrecognised Sync Code.')
        setImportPending(false)
        return
      }

      mergeRecentGroups(
        result.groups.map((g) => ({
          id: g.id,
          name: g.name,
        })),
      )

      toast({
        title: `Successfully imported ${result.groups.length} groups!`,
        description: result.label
          ? `Loaded "${result.label}" (${result.syncKey}) into your browser.`
          : `Synced ${result.groups.length} group${result.groups.length === 1 ? '' : 's'} using key "${result.syncKey}".`,
      })

      setImportKeyInput('')
      setOpen(false)
      onSuccess?.()
      router.refresh()
    } catch {
      setImportError('Unrecognised Sync Code.')
    } finally {
      setImportPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} type="button">
          <KeyRound className="w-4 h-4 mr-2" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            Sync Groups Across Devices
          </DialogTitle>
          <DialogDescription>
            Share or restore your saved groups on any browser or device using a
            short Sync Code — no account required.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'import' | 'export')}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="import" className="flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" />
              Import via Code
            </TabsTrigger>
            <TabsTrigger value="export" className="flex items-center gap-1.5">
              <Share2 className="w-3.5 h-3.5" />
              Export / Share
            </TabsTrigger>
          </TabsList>

          {/* IMPORT TAB */}
          <TabsContent value="import" className="space-y-4 pt-3">
            <form onSubmit={handleImportSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="import-sync-code">Enter Sync Code</Label>
                <Input
                  id="import-sync-code"
                  placeholder="e.g. FAMILY-TRIP-2026"
                  value={importKeyInput}
                  disabled={importPending}
                  onChange={(e) => {
                    setImportKeyInput(e.target.value.toUpperCase())
                    setImportError(null)
                  }}
                  className="font-mono uppercase tracking-wider text-base"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Entering a Sync Code merges its groups into your current
                  browser list without overwriting your existing groups.
                </p>
              </div>

              {importError && (
                <p className="text-sm text-destructive font-medium">
                  {importError}
                </p>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={importPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={importPending || !importKeyInput.trim()}
                >
                  {importPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Importing…
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 mr-2" />
                      Import Groups
                    </>
                  )}
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {/* EXPORT TAB */}
          <TabsContent value="export" className="space-y-4 pt-3">
            {localGroups.length === 0 ? (
              <div className="rounded-md border p-4 text-sm text-muted-foreground space-y-2">
                <p>You don&apos;t have any groups saved in this browser yet.</p>
                <p>
                  Switch to the <strong>Import via Code</strong> tab to pull
                  down groups from an existing Sync Code.
                </p>
              </div>
            ) : (
              <form onSubmit={handleExportSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="export-sync-code">
                    Custom Sync Code or Passphrase
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="export-sync-code"
                      placeholder="e.g. FAMILY-TRIP-2026"
                      value={exportKeyInput}
                      disabled={exportPending}
                      onChange={(e) => {
                        setExportKeyInput(e.target.value.toUpperCase())
                        setExportError(null)
                        setSavedSyncKey(null)
                      }}
                      className="font-mono uppercase tracking-wider text-base"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Generate random 6-character code"
                      disabled={exportPending}
                      onClick={() => {
                        setExportKeyInput(generateRandomSyncCode(6))
                        setSavedSyncKey(null)
                      }}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="export-sync-label">
                    Collection Label (optional)
                  </Label>
                  <Input
                    id="export-sync-label"
                    placeholder="e.g. Family & Holiday Groups"
                    value={exportLabel}
                    disabled={exportPending}
                    onChange={(e) => setExportLabel(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>
                      Groups to Include ({selectedIds.size} of{' '}
                      {localGroups.length})
                    </Label>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={toggleSelectAll}
                    >
                      {selectedIds.size === localGroups.length
                        ? 'Deselect all'
                        : 'Select all'}
                    </Button>
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-md border p-2 space-y-1.5 bg-muted/30">
                    {localGroups.map((group) => {
                      const isChecked = selectedIds.has(group.id)
                      return (
                        <label
                          key={group.id}
                          className="flex items-center gap-2.5 rounded px-2 py-1 text-sm hover:bg-muted cursor-pointer select-none"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() =>
                              toggleGroupSelection(group.id)
                            }
                          />
                          <span className="truncate flex-1">{group.name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                {exportError && (
                  <p className="text-sm text-destructive font-medium">
                    {exportError}
                  </p>
                )}

                {savedSyncKey && (
                  <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Your Sync Code is ready! Enter this code on any other
                      browser or device:
                    </p>
                    <div className="flex items-center justify-between gap-2">
                      <code className="font-mono text-lg font-bold tracking-wider text-primary">
                        {savedSyncKey}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={handleCopySyncCode}
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4 mr-1.5" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4 mr-1.5" />
                            Copy Sync Code
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setOpen(false)}
                    disabled={exportPending}
                  >
                    Close
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      exportPending ||
                      selectedIds.size === 0 ||
                      !exportKeyInput.trim()
                    }
                  >
                    {exportPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Share2 className="w-4 h-4 mr-2" />
                        Save Sync Code
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
