import type { Role } from '@orden/pass/types'
import type { ItemRow, KeyringRow, LinkRow, VaultRow, Version } from '@orden/pass/wire'
import { acceptedIn, handoversIn, keyProofIn } from '@orden/pass/wire'
import { keyringIn } from '@orden/pass/keyring'
import { listIn, objectIn } from '../body'

export interface ItemDb {
  vault_id: string
  id: string
  rev: number
  key: string
  body: string
  key_version: number
  at: number
  deleted_at: number | null
}

export interface VaultDb {
  id: string
  rev: number
  meta: string
  key_version: number
  deleted_at: number | null
  owner_id: string
  role: Role
  state: 'pending' | 'confirm' | 'active' | 'removed'
  key: string | null
  members: number
  key_proof: string | null
  handovers: string
  accepted: string | null
}

export interface VersionDb {
  rev: number
  key: string
  body: string
  key_version: number
  at: number
}

export interface LinkDb {
  id: string
  vault_id: string
  item_id: string
  expires_at: number
  max_views: number | null
  views: number
  created_at: number
}

export const ITEM_COLUMNS = 'vault_id, id, rev, key, body, key_version, at, deleted_at'

export const VAULT_SELECT = `select v.id, v.rev, v.meta, v.key_version, v.deleted_at, v.owner_id,
       m.role, m.state, m.key, v.key_proof, v.handovers, m.accepted,
       (select count(*) from pass_members o where o.vault_id = v.id and o.state <> 'removed')
         as members
  from pass_members m join pass_vaults v on v.id = m.vault_id`

export const LINK_COLUMNS = 'id, vault_id, item_id, expires_at, max_views, views, created_at'

export function itemRowOf(row: ItemDb): ItemRow {
  return {
    vault: row.vault_id,
    id: row.id,
    rev: row.rev,
    key: row.key,
    body: row.body,
    keyVersion: row.key_version,
    at: row.at,
    deleted: row.deleted_at !== null,
  }
}

export function vaultRowOf(row: VaultDb, user: string): VaultRow {
  const gone = row.deleted_at !== null || row.state === 'removed'
  return {
    id: row.id,
    rev: row.rev,
    meta: gone ? '' : row.meta,
    key: gone ? null : row.key,
    keyVersion: row.key_version,
    role: row.role,
    owner: row.owner_id === user,
    members: row.members,
    deleted: gone,
    proof: gone ? null : keyProofIn(objectIn(row.key_proof)),
    handovers: gone ? [] : (handoversIn(listIn(row.handovers)) ?? []),
    accepted: gone ? null : acceptedIn(objectIn(row.accepted)),
  }
}

export function versionOf(row: VersionDb): Version {
  return { rev: row.rev, key: row.key, body: row.body, keyVersion: row.key_version, at: row.at }
}

export function linkRowOf(row: LinkDb): LinkRow {
  return {
    id: row.id,
    vault: row.vault_id,
    item: row.item_id,
    expires: row.expires_at,
    views: row.max_views,
    seen: row.views,
    created: row.created_at,
  }
}

export function keyringRowOf(row: { keyring: string; rev: number }): KeyringRow | null {
  const keyring = keyringIn(objectIn(row.keyring))
  return keyring === null ? null : { keyring, rev: row.rev }
}
