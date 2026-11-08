import { atLeast, type Role, ROLES } from '@orden/pass/types'
import type { Env } from '../types'
import { VAULT_SELECT, type VaultDb } from './rows'

export async function membershipOf(
  env: Env,
  vault: string,
  email: string,
): Promise<VaultDb | null> {
  return await env.DB.prepare(`${VAULT_SELECT} where m.vault_id = ? and m.email = ?`)
    .bind(vault, email)
    .first<VaultDb>()
}

export async function activeIn(env: Env, vault: string, email: string): Promise<VaultDb | null> {
  const held = await membershipOf(env, vault, email)
  return held?.state === 'active' && held.deleted_at === null ? held : null
}

export function mayAct(held: VaultDb, wanted: Role): boolean {
  return atLeast(held.role, wanted)
}

export function holdsSql(vault: string, email: string, wanted: Role): string {
  const roles = ROLES.filter((role) => atLeast(role, wanted))
    .map((role) => `'${role}'`)
    .join(', ')
  return `exists (select 1 from pass_members m join pass_vaults v on v.id = m.vault_id
                   where m.vault_id = ${vault} and m.email = ${email} and m.state = 'active'
                     and v.deleted_at is null and m.role in (${roles}))`
}
