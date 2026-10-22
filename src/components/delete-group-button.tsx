'use client'

import { DeleteGroupDialog } from '@/components/delete-group-dialog'
import { Group } from '@/generated/prisma/client'

type Props = {
  group: Group
}

export function DeleteGroupButton({ group }: Props) {
  return <DeleteGroupDialog group={group} redirectOnSuccess={true} />
}
