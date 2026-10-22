'use client'

import {
  deleteRecentGroup,
  unarchiveGroup,
  unstarGroup,
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
import { useToast } from '@/components/ui/use-toast'
import { useActiveUser } from '@/lib/hooks'
import { trpc } from '@/trpc/client'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { ReactNode, useState } from 'react'

export type DeleteGroupDialogProps = {
  group: {
    id: string
    name: string
  }
  trigger?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: () => void
  redirectOnSuccess?: boolean
}

export function DeleteGroupDialog({
  group,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onSuccess,
  redirectOnSuccess = false,
}: DeleteGroupDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = isControlled
    ? (controlledOnOpenChange ?? (() => {}))
    : setUncontrolledOpen

  const { mutateAsync } = trpc.groups.delete.useMutation()
  const utils = trpc.useUtils()
  const t = useTranslations('DeleteGroupButton')
  const { toast } = useToast()
  const activeUserId = useActiveUser(group.id)
  const [inputValue, setInputValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setInputValue('')
    }
    setOpen(nextOpen)
  }

  const isConfirmed =
    inputValue.trim().toLowerCase() === group.name.trim().toLowerCase()

  const handleDelete = async (event?: React.FormEvent) => {
    if (event) {
      event.preventDefault()
      event.stopPropagation()
    }
    if (isSubmitting || !isConfirmed) return

    setIsSubmitting(true)
    try {
      await mutateAsync({
        groupId: group.id,
        groupName: inputValue.trim(),
        participantId: activeUserId ?? undefined,
      })

      // Clean up all local storage references for this group
      deleteRecentGroup({ id: group.id, name: group.name })
      unstarGroup(group.id)
      unarchiveGroup(group.id)
      try {
        localStorage.removeItem(`${group.id}-activeUser`)
      } catch {}

      await utils.groups.invalidate()

      toast({
        title: t('SuccessToast.title'),
        description: t('SuccessToast.description', { name: group.name }),
      })

      handleOpenChange(false)
      onSuccess?.()

      if (redirectOnSuccess) {
        router.push('/groups')
      }
    } catch {
      toast({
        title: t('ErrorToast.title'),
        description: t('ErrorToast.description'),
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : !isControlled ? (
        <DialogTrigger asChild>
          <Button type="button" variant="destructive" className="gap-2">
            <Trash2 className="w-4 h-4" />
            {t('title')}
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="gap-1">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            <DialogTitle className="text-destructive">{t('title')}</DialogTitle>
          </div>
          <DialogDescription className="text-left pt-2 leading-relaxed">
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleDelete} className="space-y-4 pt-1">
          <div className="space-y-2">
            <label
              htmlFor={`confirm-group-name-${group.id}`}
              className="text-xs font-medium text-muted-foreground block"
            >
              {t('confirmPrompt')}{' '}
              <strong className="text-foreground select-all font-semibold">
                {group.name}
              </strong>
            </label>
            <Input
              id={`confirm-group-name-${group.id}`}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={group.name}
              autoComplete="off"
              className="text-base"
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleOpenChange(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!isConfirmed || isSubmitting}
              className="gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('deleting')}
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  {t('confirmButton')}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
