export const TIME_KIND = /^[a-z]{1,16}$/

export const TIME_ID = /^[A-Za-z0-9_-]{1,64}$/

export const MOST_TIME_CHANGES = 200

export const TIME_PAGE = 1000

export const MOST_TIME_BYTES = 4096

export const MOST_TIME_ENTRIES = 200_000

export interface TimeChange {
  kind: string
  id: string
  value: Record<string, unknown> | null
}

export interface TimeEntry extends TimeChange {
  seq: number
  at: number
}

export interface TimePage {
  entries: TimeEntry[]
  cursor: number
  more: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const bytesOf = (text: string): number => new TextEncoder().encode(text).length

export function timeChangeOf(value: unknown): TimeChange | null {
  if (!isRecord(value)) return null
  const { kind, id } = value
  if (typeof kind !== 'string' || !TIME_KIND.test(kind)) return null
  if (typeof id !== 'string' || !TIME_ID.test(id)) return null
  const held = value.value ?? null
  if (held === null) return { kind, id, value: null }
  if (!isRecord(held) || bytesOf(JSON.stringify(held)) > MOST_TIME_BYTES) return null
  return { kind, id, value: held }
}

export function timeChangesOf(body: unknown): TimeChange[] | null {
  if (!isRecord(body) || !Array.isArray(body.changes)) return null
  if (body.changes.length > MOST_TIME_CHANGES) return null
  const out: TimeChange[] = []
  for (const one of body.changes as unknown[]) {
    const change = timeChangeOf(one)
    if (!change) return null
    out.push(change)
  }
  return out
}

export function timePageOf(body: unknown): TimePage | null {
  if (!isRecord(body) || !Array.isArray(body.entries)) return null
  if (typeof body.cursor !== 'number' || !Number.isInteger(body.cursor)) return null
  const entries: TimeEntry[] = []
  for (const one of body.entries as unknown[]) {
    const change = timeChangeOf(one)
    if (!change || !isRecord(one) || typeof one.seq !== 'number' || typeof one.at !== 'number') {
      continue
    }
    entries.push({ ...change, seq: one.seq, at: one.at })
  }
  return { entries, cursor: body.cursor, more: body.more === true }
}
