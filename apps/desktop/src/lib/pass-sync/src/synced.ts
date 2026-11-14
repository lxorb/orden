import type { Invite, KeyringRow as AccountKeyring } from '@orden/pass/wire'
import { inviteIn, keyringRowIn } from '@orden/pass/wire'
import type { Change, ItemRow, KeyringRow, VaultRow, VersionRow } from './local'

export interface DeviceRows {
  keyring(): Promise<KeyringRow | null>
  writeKeyring(row: KeyringRow): Promise<void>
  vaults(): Promise<VaultRow[]>
  items(): Promise<ItemRow[]>
  item(vault: string, id: string): Promise<ItemRow | null>
  versions(vault: string, id: string): Promise<VersionRow[]>
  write(change: Change): Promise<void>
  read(key: string): Promise<unknown>
  keep(key: string, value: unknown): Promise<void>
}

export interface ItemBase {
  rev: number
  key: string
  body: string
  keyVersion: number
}

export interface VaultBase {
  rev: number
  meta: string
}

export interface Cursor {
  account: string
  seq: number
}

const CURSOR = 'sync'
const KEYRING = 'base:keyring'
const ACCOUNT_KEYRING = 'account-keyring'
const INVITES = 'invites'

const itemKey = (vault: string, id: string) => `base:item:${vault}:${id}`
const vaultKey = (id: string) => `base:vault:${id}`

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const whole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export async function cursorOf(rows: DeviceRows): Promise<Cursor | null> {
  const raw = await rows.read(CURSOR)
  if (!isFields(raw) || typeof raw.account !== 'string' || !whole(raw.seq)) return null
  return { account: raw.account, seq: raw.seq }
}

export async function keepCursor(rows: DeviceRows, cursor: Cursor | null): Promise<void> {
  await rows.keep(CURSOR, cursor)
}

export async function itemBaseOf(
  rows: DeviceRows,
  vault: string,
  id: string,
): Promise<ItemBase | null> {
  const raw = await rows.read(itemKey(vault, id))
  if (!isFields(raw) || !whole(raw.rev) || !whole(raw.keyVersion)) return null
  if (typeof raw.key !== 'string' || typeof raw.body !== 'string') return null
  return { rev: raw.rev, key: raw.key, body: raw.body, keyVersion: raw.keyVersion }
}

export async function keepItemBase(
  rows: DeviceRows,
  vault: string,
  id: string,
  base: ItemBase | null,
): Promise<void> {
  await rows.keep(itemKey(vault, id), base)
}

export async function vaultBaseOf(rows: DeviceRows, id: string): Promise<VaultBase | null> {
  const raw = await rows.read(vaultKey(id))
  if (!isFields(raw) || !whole(raw.rev) || typeof raw.meta !== 'string') return null
  return { rev: raw.rev, meta: raw.meta }
}

export async function keepVaultBase(
  rows: DeviceRows,
  id: string,
  base: VaultBase | null,
): Promise<void> {
  await rows.keep(vaultKey(id), base)
}

export async function keyringBaseOf(rows: DeviceRows): Promise<number> {
  const raw = await rows.read(KEYRING)
  return whole(raw) ? raw : 0
}

export async function keepKeyringBase(rows: DeviceRows, rev: number): Promise<void> {
  await rows.keep(KEYRING, rev)
}

export async function accountKeyringOf(rows: DeviceRows): Promise<AccountKeyring | null> {
  return keyringRowIn(await rows.read(ACCOUNT_KEYRING))
}

export async function keepAccountKeyring(
  rows: DeviceRows,
  row: AccountKeyring | null,
): Promise<void> {
  await rows.keep(ACCOUNT_KEYRING, row)
}

export async function invitesOf(rows: DeviceRows): Promise<Invite[]> {
  const raw = await rows.read(INVITES)
  if (!Array.isArray(raw)) return []
  return raw.flatMap((one) => inviteIn(one) ?? [])
}

export async function keepInvites(rows: DeviceRows, invites: readonly Invite[]): Promise<void> {
  await rows.keep(INVITES, invites.length ? invites : null)
}

export async function keepAdopted(rows: DeviceRows, rev: number): Promise<void> {
  await keepKeyringBase(rows, rev)
  await keepAccountKeyring(rows, null)
  await keepCursor(rows, null)
}
