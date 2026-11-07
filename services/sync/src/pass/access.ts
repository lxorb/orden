import { atLeast, type Role } from '@orden/pass/types'
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
