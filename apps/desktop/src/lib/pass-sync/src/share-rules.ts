import type { Vault } from '@orden/pass/types'
import { atLeast } from '@orden/pass/types'

type Held = Pick<Vault, 'role' | 'hidePasswordsFromViewers'>

export function hidesPasswords(vault: Held): boolean {
  return vault.role === 'viewer' && vault.hidePasswordsFromViewers
}

export function mayEdit(vault: Pick<Vault, 'role'>): boolean {
  return atLeast(vault.role, 'editor')
}

export function mayManage(vault: Pick<Vault, 'role'>): boolean {
  return atLeast(vault.role, 'manager')
}

export function mayHandOn(vault: Pick<Vault, 'role'>): boolean {
  return vault.role === 'owner'
}
