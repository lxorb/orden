import { blank } from '../envelope'
import type {
  Card,
  CardBrand,
  Content,
  Field,
  FieldKind,
  Identity,
  IdentityKey,
  Login,
  Note,
  Passkey,
  Section,
  Website,
} from '../types'
import { IDENTITY_FIELDS } from '../types'
import { totpIn, totpUri } from '../totp'
import { normalizeUrl } from '../urls'
import type { Imported, ImportedItem, Skipped } from './types'

export type Files = Record<string, Uint8Array>

export function textOf(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

export function stringOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  return ''
}

export function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
  } catch {
    throw new ImportError('The file is not JSON.')
  }
}

export class ImportError extends Error {
  override name = 'ImportError'
}

export function pick(record: Readonly<Record<string, string>>, ...names: string[]): string {
  for (const name of names) {
    const found = record[name]
    if (found !== undefined && found !== '') return found
  }
  const lower = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]))
  for (const name of names) {
    const found = lower.get(name.toLowerCase())
    if (found !== undefined && found !== '') return found
  }
  return ''
}

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

export function fieldKindOf(kind: string): FieldKind {
  const word = kind.toLowerCase()
  if (['hidden', 'concealed', 'password', 'secret', 'pin', 'protected', 'masked'].includes(word)) {
    return 'hidden'
  }
  if (['totp', 'otp', 'onetimepassword', 'one-time password', '2fa'].includes(word)) return 'totp'
  if (['date', 'timestamp', 'monthyear', 'birthdate'].includes(word)) return 'date'
  return 'text'
}

export function fieldOf(name: string, value: string, kind: FieldKind = 'text'): Field {
  return { id: newId(), name, kind, value: kind === 'totp' ? totpOf(value) : value }
}

export function fieldsOf(
  entries: readonly { name: string; value: string; kind?: FieldKind }[],
): Field[] {
  return entries
    .filter((one) => one.value !== '')
    .map((one) => fieldOf(one.name, one.value, one.kind ?? 'text'))
}

export function sectionOf(name: string, fields: Field[]): Section {
  return { id: newId(), name, fields }
}

export function totpOf(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  const parsed = totpIn(trimmed)
  return parsed === null ? trimmed : totpUri(parsed)
}

export function urlsIn(text: string): string[] {
  return text
    .split(/[\r\n]+|,\s*(?=[a-z][a-z0-9+.-]*:\/\/)/i)
    .map((one) => one.trim())
    .filter((one) => one !== '')
}

export function websitesOf(urls: readonly string[]): Website[] {
  const seen = new Set<string>()
  const websites: Website[] = []
  for (const raw of urls) {
    const url = normalizeUrl(raw.trim())
    if (url === null || seen.has(url)) continue
    seen.add(url)
    websites.push({ url, match: 'domain' })
  }
  return websites
}

export interface LoginParts {
  title?: string
  note?: string
  email?: string
  username?: string
  password?: string
  totp?: string
  urls?: readonly string[]
  fields?: Field[]
  passkeys?: Passkey[]
}

export function loginOf(parts: LoginParts): Login {
  const login = blank('login')
  const email = (parts.email ?? '').trim()
  const username = (parts.username ?? '').trim()
  const toEmail = email === '' && username.includes('@')
  const websites = websitesOf(parts.urls ?? [])
  return {
    ...login,
    title: (parts.title ?? '').trim() || titleFromWebsites(websites),
    note: parts.note ?? '',
    email: toEmail ? username : email,
    username: toEmail ? '' : username,
    password: parts.password ?? '',
    totp: totpOf(parts.totp ?? ''),
    websites,
    passkeys: parts.passkeys ?? [],
    fields: parts.fields ?? [],
  }
}

function titleFromWebsites(websites: readonly Website[]): string {
  const first = websites[0]
  if (!first) return ''
  try {
    return new URL(first.url).hostname.replace(/^www\./, '')
  } catch {
    return first.url
  }
}

export function noteOf(title: string, note: string, fields: Field[] = []): Note {
  return { ...blank('note'), title: title.trim(), note, fields }
}

export interface CardParts {
  title?: string
  note?: string
  holder?: string
  number?: string
  expiry?: string
  code?: string
  pin?: string
  fields?: Field[]
}

export function cardOf(parts: CardParts): Card {
  const number = (parts.number ?? '').replace(/[\s-]/g, '')
  return {
    ...blank('card'),
    title: (parts.title ?? '').trim(),
    note: parts.note ?? '',
    holder: (parts.holder ?? '').trim(),
    brand: brandOf(number),
    number,
    expiry: expiryOf(parts.expiry ?? ''),
    code: (parts.code ?? '').trim(),
    pin: (parts.pin ?? '').trim(),
    fields: parts.fields ?? [],
  }
}

export function brandOf(number: string): CardBrand {
  const digits = number.replace(/\D/g, '')
  if (digits.startsWith('4')) return 'visa'
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return 'mastercard'
  if (/^3[47]/.test(digits)) return 'amex'
  if (/^(6011|65|64[4-9]|622)/.test(digits)) return 'discover'
  return 'other'
}

function fullYear(year: string): number {
  const n = Number(year)
  return year.length <= 2 ? 2000 + n : n
}

function yearMonth(year: number, month: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return ''
  if (year < 1900 || year > 2999) return ''
  return `${String(year)}-${String(month).padStart(2, '0')}`
}

export function expiryOf(text: string, year?: string): string {
  const raw = text.trim()
  if (year !== undefined) {
    const y = year.trim()
    if (raw === '' || y === '') return ''
    return yearMonth(fullYear(y), Number(raw))
  }
  if (raw === '') return ''
  let match = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?(?:[T ].*)?$/.exec(raw)
  if (match) return yearMonth(Number(match[1]), Number(match[2]))
  match = /^(\d{1,2})\s*[-/.]\s*(\d{2}|\d{4})$/.exec(raw)
  if (match) return yearMonth(fullYear(match[2] ?? ''), Number(match[1]))
  match = /^(\d{2})(\d{2})$/.exec(raw)
  if (match) return yearMonth(fullYear(match[2] ?? ''), Number(match[1]))
  match = /^(\d{2})(\d{4})$/.exec(raw)
  if (match) return yearMonth(Number(match[2]), Number(match[1]))
  match = /^(\d{4})(\d{2})$/.exec(raw)
  if (match) return yearMonth(Number(match[1]), Number(match[2]))
  return ''
}

const IDENTITY_KEYS = new Set<string>(Object.values(IDENTITY_FIELDS).flat())

export function isIdentityKey(key: string): key is IdentityKey {
  return IDENTITY_KEYS.has(key)
}

export interface IdentityParts {
  title?: string
  note?: string
  values: Partial<Record<IdentityKey, string>>
  extra?: readonly { name: string; value: string; kind?: FieldKind }[]
  fields?: Field[]
}

export function identityOf(parts: IdentityParts): Identity {
  const values: Partial<Record<IdentityKey, string>> = {}
  for (const [key, value] of Object.entries(parts.values)) {
    const trimmed = value.trim()
    if (trimmed !== '' && isIdentityKey(key)) values[key] = trimmed
  }
  if (values.fullName === undefined) {
    const full = [values.firstName, values.middleName, values.lastName]
      .filter((one) => one !== undefined)
      .join(' ')
    if (full !== '') values.fullName = full
  }
  const extra = fieldsOf(parts.extra ?? [])
  return {
    ...blank('identity'),
    title: (parts.title ?? '').trim() || (values.fullName ?? ''),
    note: parts.note ?? '',
    values,
    sections: extra.length > 0 ? [sectionOf('Imported', extra)] : [],
    fields: parts.fields ?? [],
  }
}

export function dateOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e11 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  const text = value.trim()
  if (/^\d+(\.\d+)?$/.test(text)) return dateOf(Number(text))
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? null : parsed
}

export interface ItemParts {
  created?: number | null
  modified?: number | null
  pinned?: boolean
  trashed?: boolean
  folder?: string | null
}

export function itemOf(content: Content, parts: ItemParts = {}): ImportedItem {
  const folder = (parts.folder ?? '').trim()
  return {
    content,
    created: parts.created ?? null,
    modified: parts.modified ?? null,
    pinned: parts.pinned ?? false,
    trashed: parts.trashed ?? false,
    folder: folder === '' ? null : folder,
  }
}

export function isEmptyContent(content: Content): boolean {
  if (content.title !== '' || content.note !== '' || content.fields.length > 0) return false
  switch (content.kind) {
    case 'login':
      return (
        content.email === '' &&
        content.username === '' &&
        content.password === '' &&
        content.totp === '' &&
        content.websites.length === 0 &&
        content.passkeys.length === 0
      )
    case 'card':
      return content.number === '' && content.holder === '' && content.code === ''
    case 'identity':
      return Object.keys(content.values).length === 0 && content.sections.length === 0
    case 'note':
      return true
    case 'alias':
      return content.address === ''
    case 'custom':
    case 'ssh':
    case 'wifi':
      return content.sections.length === 0
  }
}

export class Collector {
  private readonly vaults = new Map<string, ImportedItem[]>()
  private readonly skipped: Skipped[] = []

  constructor(private readonly fallback: string) {}

  vault(name: string): void {
    const key = name.trim() || this.fallback
    if (!this.vaults.has(key)) this.vaults.set(key, [])
  }

  add(item: ImportedItem, vault = ''): void {
    if (isEmptyContent(item.content)) return
    const key = vault.trim() || this.fallback
    const list = this.vaults.get(key)
    if (list) list.push(item)
    else this.vaults.set(key, [item])
  }

  skip(reason: string, title: string): void {
    this.skipped.push({ reason, title })
  }

  result(): Imported {
    return {
      vaults: [...this.vaults]
        .filter(([, items]) => items.length > 0)
        .map(([name, items]) => ({ name, items })),
      skipped: this.skipped,
    }
  }
}

export function unknownKind(
  into: Collector,
  kind: string,
  title: string,
  note: string,
  extra: readonly { name: string; value: string; kind?: FieldKind }[],
  parts: ItemParts = {},
  vault = '',
): void {
  into.add(itemOf(noteOf(title, note, fieldsOf(extra)), parts), vault)
  into.skip(`Kept as a note: Orden has no kind for "${kind}".`, title)
}
