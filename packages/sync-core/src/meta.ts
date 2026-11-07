export type ItemMeta = Readonly<Record<string, string>>

export type MetaPatch = Readonly<Record<string, string | null>>

export const MOST_META_KEYS = 16

export const LONGEST_META_VALUE = 2048

const KEY = /^[a-z][a-z0-9-]{0,31}$/

export function isMetaKey(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value)
}

function isMetaValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= LONGEST_META_VALUE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function metaOf(value: unknown): ItemMeta | null {
  if (!isRecord(value)) return null
  const entries = Object.entries(value)
  if (entries.length > MOST_META_KEYS) return null
  const out: Record<string, string> = {}
  for (const [key, said] of entries) {
    if (!isMetaKey(key) || !isMetaValue(said)) return null
    out[key] = said
  }
  return out
}

export function metaPatchOf(value: unknown): MetaPatch | null {
  if (!isRecord(value)) return null
  const entries = Object.entries(value)
  if (entries.length === 0 || entries.length > MOST_META_KEYS) return null
  const out: Record<string, string | null> = {}
  for (const [key, said] of entries) {
    if (!isMetaKey(key) || (said !== null && !isMetaValue(said))) return null
    out[key] = said
  }
  return out
}

export const MERGED_META_KEYS: ReadonlySet<string> = new Set(['done-on', 'cancelled-on'])

const nameOf = (token: string) => token.slice(0, token.indexOf(':'))

function mergedValue(had: string | undefined, said: string): string {
  if (had === undefined) return said
  const told = said.split(' ').filter(Boolean)
  const names = new Set(told.map(nameOf))
  let out = told.join(' ')
  for (const token of had.split(' ')) {
    if (!token || !token.includes(':') || names.has(nameOf(token))) continue
    if (out.length + token.length + 1 > LONGEST_META_VALUE) break
    out = out ? `${out} ${token}` : token
  }
  return out
}

export function patched(had: ItemMeta | undefined, patch: MetaPatch): ItemMeta | undefined {
  const merged: Record<string, string | null> = { ...patch }
  for (const [key, said] of Object.entries(patch)) {
    if (said !== null && MERGED_META_KEYS.has(key)) merged[key] = mergedValue(had?.[key], said)
  }
  const out: Record<string, string> = Object.fromEntries(
    Object.entries({ ...had, ...merged }).filter((one): one is [string, string] => one[1] !== null),
  )
  const keys = Object.keys(out)
  if (keys.length > MOST_META_KEYS) return had
  return keys.length ? out : undefined
}

export function sameMeta(one: ItemMeta | undefined, other: ItemMeta | undefined): boolean {
  const mine = Object.keys(one ?? {})
  if (mine.length !== Object.keys(other ?? {}).length) return false
  return mine.every((key) => one?.[key] === other?.[key])
}

export function metaText(meta: ItemMeta | undefined): string | null {
  if (!meta || Object.keys(meta).length === 0) return null
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(meta).sort()) sorted[key] = meta[key] ?? ''
  return JSON.stringify(sorted)
}

export function metaFromText(text: string | null | undefined): ItemMeta | undefined {
  if (!text) return undefined
  try {
    const meta = metaOf(JSON.parse(text))
    return meta && Object.keys(meta).length ? meta : undefined
  } catch {
    return undefined
  }
}
