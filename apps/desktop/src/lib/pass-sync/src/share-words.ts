import type { Role } from '@orden/pass/types'
import type { MemberState } from '@orden/pass/wire'
import type { InvitedRole } from './share'

export const INVITED_ROLES: readonly InvitedRole[] = ['viewer', 'editor', 'manager']
export function roleName(role: Role): string {
  return { viewer: 'Can view', editor: 'Can edit', manager: 'Can manage', owner: 'Owner' }[role]
}
export function stateName(state: MemberState, managing: boolean): string {
  switch (state) {
    case 'pending':
      return 'Pending'
    case 'confirm':
      return managing ? 'Waiting for you to confirm' : 'Waiting to be confirmed'
    case 'active':
      return 'Active'
  }
}
