export const INBOX_ID = /^[A-Za-z0-9_-]{1,64}$/

export const INBOX_FIELD = /^[a-z][A-Za-z0-9]{0,31}$/

export const INBOX_STAMP = /^[0-9a-z]{9}-[0-9a-z]{4}-[A-Za-z0-9_-]{1,32}$/

export const MOST_INBOX_CHANGES = 200

export const INBOX_PAGE = 1000

export const MOST_INBOX_BYTES = 16_384

export const MOST_INBOX_ITEMS = 100_000

export type InboxValue = string | number | boolean | null | readonly string[]

export type InboxFields = Record<string, InboxValue>

export type InboxStamps = Record<string, string>

export interface InboxChange {
  id: string
  fields: InboxFields
  stamps: InboxStamps
}

export interface InboxItem extends InboxChange {
  seq: number
  at: number
}

export interface InboxPage {
  items: InboxItem[]
  cursor: number
  more: boolean
}

export interface InboxHeld {
  fields: InboxFields
  stamps: InboxStamps
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const bytesOf = (text: string): number => new TextEncoder().encode(text).length

const isValue = (value: unknown): value is InboxValue =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (Array.isArray(value) && value.every((one) => typeof one === 'string'))

export function inboxStamp(at: number, count: number, device: string): string {
  const time = Math.max(0, Math.floor(at)).toString(36).padStart(9, '0').slice(-9)
  const step = Math.max(0, Math.floor(count)).toString(36).padStart(4, '0').slice(-4)
  return `${time}-${step}-${device}`
}

export function newer(stamp: string | undefined, than: string | undefined): boolean {
  if (stamp === undefined) return false
  if (than === undefined) return true
  return stamp > than
}

export function inboxChangeOf(value: unknown): InboxChange | null {
  if (!isRecord(value)) return null
  const { id, fields, stamps } = value
  if (typeof id !== 'string' || !INBOX_ID.test(id)) return null
  if (!isRecord(fields) || !isRecord(stamps)) return null
  const keys = Object.keys(fields)
  if (!keys.length || keys.length !== Object.keys(stamps).length) return null
  for (const key of keys) {
    if (!INBOX_FIELD.test(key) || !isValue(fields[key])) return null
    const stamp = stamps[key]
    if (typeof stamp !== 'string' || !INBOX_STAMP.test(stamp)) return null
  }
  if (bytesOf(JSON.stringify(value)) > MOST_INBOX_BYTES) return null
  return { id, fields: fields as InboxFields, stamps: stamps as InboxStamps }
}

export function inboxChangesOf(body: unknown): InboxChange[] | null {
  if (!isRecord(body) || !Array.isArray(body.changes)) return null
  if (body.changes.length > MOST_INBOX_CHANGES) return null
  const out: InboxChange[] = []
  for (const one of body.changes as unknown[]) {
    const change = inboxChangeOf(one)
    if (!change) return null
    out.push(change)
  }
  return out
}

export function inboxPageOf(body: unknown): InboxPage | null {
  if (!isRecord(body) || !Array.isArray(body.items)) return null
  if (typeof body.cursor !== 'number' || !Number.isInteger(body.cursor)) return null
  const items: InboxItem[] = []
  for (const one of body.items as unknown[]) {
    const change = inboxChangeOf(one)
    if (!change || !isRecord(one) || typeof one.seq !== 'number' || typeof one.at !== 'number') {
      continue
    }
    items.push({ ...change, seq: one.seq, at: one.at })
  }
  return { items, cursor: body.cursor, more: body.more === true }
}

export function mergedInbox(
  held: InboxHeld | null,
  change: { fields: InboxFields; stamps: InboxStamps },
): InboxHeld & { changed: boolean } {
  const fields: InboxFields = { ...held?.fields }
  const stamps: InboxStamps = { ...held?.stamps }
  let changed = false
  for (const [key, value] of Object.entries(change.fields)) {
    const stamp = change.stamps[key]
    if (stamp === undefined || !newer(stamp, stamps[key])) continue
    fields[key] = value
    stamps[key] = stamp
    changed = true
  }
  return { fields, stamps, changed }
}
