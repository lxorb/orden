import type { Role } from '@orden/pass/types'
import type { MemberState } from '@orden/pass/wire'
import { t } from '../i18n.svelte'
import type { InvitedRole } from './share'

export const INVITED_ROLES: readonly InvitedRole[] = ['viewer', 'editor', 'manager']

export function roleName(role: Role): string {
  switch (role) {
    case 'viewer':
      return t('Can view')
    case 'editor':
      return t('Can edit')
    case 'manager':
      return t('Can manage')
    case 'owner':
      return t('Owner')
  }
}

export function stateName(state: MemberState, managing: boolean): string {
  switch (state) {
    case 'pending':
      return t('Pending')
    case 'confirm':
      return managing ? t('Waiting for you to confirm') : t('Waiting to be confirmed')
    case 'active':
      return t('Active')
  }
}
