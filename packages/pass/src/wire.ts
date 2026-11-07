import { type Keyring, keyringIn } from './keyring'
import { BASE64, isSignature, isSignPub } from './shape'
import { ROLES, type Role } from './types'

export const MOST_VAULTS = 50
export const MOST_MEMBERS = 10
export const MOST_ITEMS = 10000
export const MOST_ITEM_BYTES = 64 * 1024
export const MOST_KEYRING_BYTES = 16 * 1024
export const MOST_META_BYTES = 64 * 1024
export const MOST_KEY_BYTES = 1024
export const MOST_VERSIONS = 30
export const MOST_PAGE = 500
export const MOST_LINKS = 500
export const MOST_LINK_VIEWS = 100
export const LONGEST_LINK = 30 * 24 * 60 * 60 * 1000
export const LONGEST_EMAIL = 254
export const LONGEST_NAME = 200
export const MOST_HANDOVERS = 50

export const MEMBER_STATES = ['pending', 'active', 'confirm'] as const

export type MemberState = (typeof MEMBER_STATES)[number]

export interface KeyProof {
  by: string
  sig: string
  vouch: string | null
}

export interface Handover {
  to: string
  sig: string
}

export interface Accepted {
  owner: string
  sig: string
}

export interface Pin {
  owner: string
  vouch: string | null
}

export interface PersonKey {
  pub: string
  signPub: string
}

export interface KeyringRow {
  keyring: Keyring
  rev: number
}

export interface VaultRow {
  id: string
  rev: number
  meta: string
  key: string | null
  keyVersion: number
  role: Role
  owner: boolean
  members: number
  deleted: boolean
  proof: KeyProof | null
  handovers: Handover[]
  accepted: Accepted | null
}

export interface ItemRow {
  vault: string
  id: string
  rev: number
  key: string
  body: string
  keyVersion: number
  at: number
  deleted: boolean
}

export interface Version {
  rev: number
  key: string
  body: string
  keyVersion: number
  at: number
}

export interface Invite {
  vault: string
  from: string
  fromName: string
  role: Role
  key: string | null
  meta: string
  keyVersion: number
  fromKey: PersonKey | null
  proof: KeyProof | null
  pin: Pin | null
}

export interface Member {
  email: string
  name: string
  role: Role
  state: MemberState
  pub: string | null
  signPub: string | null
  vouch: string | null
}

export interface Changes {
  seq: number
  more: boolean
  keyring: KeyringRow | null
  vaults: VaultRow[]
  items: ItemRow[]
  invites: Invite[]
}

export interface ItemPage {
  items: ItemRow[]
  more: boolean
}

export interface LinkRow {
  id: string
  vault: string
  item: string
  expires: number
  views: number | null
  seen: number
  created: number
}

export interface LinkOpened {
  body: string
  expires: number
  left: number | null
}

const ID = /^[A-Za-z0-9_-]{8,64}$/

type Fields = Record<string, unknown>

function fieldsOf(value: unknown): Fields | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Fields)
    : null
}

export function isPassId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

export function isSealed(value: unknown, most: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= most && BASE64.test(value)
}

export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

function isState(value: unknown): value is MemberState {
  return typeof value === 'string' && (MEMBER_STATES as readonly string[]).includes(value)
}

function isText(value: unknown, most: number): value is string {
  return typeof value === 'string' && value.length <= most
}

function sealedOrNull(value: unknown, most: number): value is string | null {
  return value === null || isSealed(value, most)
}

function listOf<T>(value: unknown, each: (one: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  const read: T[] = []
  for (const one of value) {
    const row = each(one)
    if (row === null) return null
    read.push(row)
  }
  return read
}

export function keyProofIn(value: unknown): KeyProof | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { by, sig, vouch } = raw
  if (!isSignPub(by) || !isSignature(sig) || !(vouch === null || isSignature(vouch))) return null
  return { by, sig, vouch }
}

export function handoverIn(value: unknown): Handover | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { to, sig } = raw
  return isSignPub(to) && isSignature(sig) ? { to, sig } : null
}

export function handoversIn(value: unknown): Handover[] | null {
  const read = listOf(value, handoverIn)
  return read !== null && read.length <= MOST_HANDOVERS ? read : null
}

export function acceptedIn(value: unknown): Accepted | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { owner, sig } = raw
  return isSignPub(owner) && isSignature(sig) ? { owner, sig } : null
}

export function pinIn(value: unknown): Pin | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { owner, vouch } = raw
  return isSignPub(owner) && (vouch === null || isSignature(vouch)) ? { owner, vouch } : null
}

export function personKeyIn(value: unknown): PersonKey | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { pub, signPub } = raw
  return isSealed(pub, MOST_KEY_BYTES) && isSignPub(signPub) ? { pub, signPub } : null
}

function optional<T>(value: unknown, read: (one: unknown) => T | null): T | null | undefined {
  if (value === undefined || value === null) return null
  const one = read(value)
  return one ?? undefined
}

export function keyringRowIn(value: unknown): KeyringRow | null {
  const raw = fieldsOf(value)
  if (raw === null || !isCount(raw.rev) || raw.rev < 1) return null
  const keyring = keyringIn(raw.keyring)
  return keyring === null ? null : { keyring, rev: raw.rev }
}

export function vaultRowIn(value: unknown): VaultRow | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { id, rev, meta, key, keyVersion, role, owner, members, deleted } = raw
  const proof = optional(raw.proof, keyProofIn)
  const accepted = optional(raw.accepted, acceptedIn)
  const handovers = raw.handovers === undefined ? [] : handoversIn(raw.handovers)
  if (
    proof === undefined ||
    accepted === undefined ||
    handovers === null ||
    !isPassId(id) ||
    !isCount(rev) ||
    typeof deleted !== 'boolean' ||
    !(deleted ? meta === '' || isSealed(meta, MOST_META_BYTES) : isSealed(meta, MOST_META_BYTES)) ||
    !sealedOrNull(key, MOST_KEY_BYTES) ||
    !isCount(keyVersion) ||
    !isRole(role) ||
    typeof owner !== 'boolean' ||
    !isCount(members)
  )
    return null
  return {
    id,
    rev,
    meta: meta as string,
    key,
    keyVersion,
    role,
    owner,
    members,
    deleted,
    proof,
    handovers,
    accepted,
  }
}

export function itemRowIn(value: unknown): ItemRow | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { vault, id, rev, key, body, keyVersion, at, deleted } = raw
  if (
    !isPassId(vault) ||
    !isPassId(id) ||
    !isCount(rev) ||
    rev < 1 ||
    typeof deleted !== 'boolean' ||
    !isCount(keyVersion) ||
    !isCount(at)
  )
    return null
  const sealed = deleted
    ? key === '' && body === ''
    : isSealed(key, MOST_KEY_BYTES) && isSealed(body, MOST_ITEM_BYTES)
  if (!sealed) return null
  return { vault, id, rev, key: key as string, body: body as string, keyVersion, at, deleted }
}

export function versionIn(value: unknown): Version | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { rev, key, body, keyVersion, at } = raw
  if (
    !isCount(rev) ||
    rev < 1 ||
    !isSealed(key, MOST_KEY_BYTES) ||
    !isSealed(body, MOST_ITEM_BYTES) ||
    !isCount(keyVersion) ||
    !isCount(at)
  )
    return null
  return { rev, key, body, keyVersion, at }
}

export function inviteIn(value: unknown): Invite | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { vault, from, fromName, role, key, meta } = raw
  const keyVersion = raw.keyVersion ?? 1
  const fromKey = optional(raw.fromKey, personKeyIn)
  const proof = optional(raw.proof, keyProofIn)
  const pin = optional(raw.pin, pinIn)
  if (
    fromKey === undefined ||
    proof === undefined ||
    pin === undefined ||
    !isCount(keyVersion) ||
    !isPassId(vault) ||
    !isText(from, LONGEST_EMAIL) ||
    !isText(fromName, LONGEST_NAME) ||
    !isRole(role) ||
    !sealedOrNull(key, MOST_KEY_BYTES) ||
    !isSealed(meta, MOST_META_BYTES)
  )
    return null
  return { vault, from, fromName, role, key, meta, keyVersion, fromKey, proof, pin }
}

export function memberIn(value: unknown): Member | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { email, name, role, state, pub } = raw
  const signPub = raw.signPub ?? null
  const vouch = raw.vouch ?? null
  if (
    !(signPub === null || isSignPub(signPub)) ||
    !(vouch === null || isSignature(vouch)) ||
    !isText(email, LONGEST_EMAIL) ||
    email.length === 0 ||
    !isText(name, LONGEST_NAME) ||
    !isRole(role) ||
    !isState(state) ||
    !sealedOrNull(pub, MOST_KEY_BYTES)
  )
    return null
  return { email, name, role, state, pub, signPub, vouch }
}

export function changesIn(value: unknown): Changes | null {
  const raw = fieldsOf(value)
  if (raw === null || !isCount(raw.seq) || typeof raw.more !== 'boolean') return null
  const keyring = raw.keyring === null ? null : keyringRowIn(raw.keyring)
  if (raw.keyring !== null && keyring === null) return null
  const vaults = listOf(raw.vaults, vaultRowIn)
  const items = listOf(raw.items, itemRowIn)
  const invites = listOf(raw.invites, inviteIn)
  if (vaults === null || items === null || invites === null) return null
  return { seq: raw.seq, more: raw.more, keyring, vaults, items, invites }
}

export function itemPageIn(value: unknown): ItemPage | null {
  const raw = fieldsOf(value)
  if (raw === null || typeof raw.more !== 'boolean') return null
  const items = listOf(raw.items, itemRowIn)
  return items === null ? null : { items, more: raw.more }
}

export function linkRowIn(value: unknown): LinkRow | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { id, vault, item, expires, views, seen, created } = raw
  if (
    !isPassId(id) ||
    !isPassId(vault) ||
    !isPassId(item) ||
    !isCount(expires) ||
    !(views === null || (isCount(views) && views >= 1 && views <= MOST_LINK_VIEWS)) ||
    !isCount(seen) ||
    !isCount(created)
  )
    return null
  return { id, vault, item, expires, views, seen, created }
}

export function linkOpenedIn(value: unknown): LinkOpened | null {
  const raw = fieldsOf(value)
  if (raw === null) return null
  const { body, expires, left } = raw
  if (!isSealed(body, MOST_ITEM_BYTES) || !isCount(expires) || !(left === null || isCount(left)))
    return null
  return { body, expires, left }
}
