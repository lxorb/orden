import type { Item } from './types'
import { watchedLogins } from './monitor'

export interface FetchedResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type Fetcher = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchedResponse>

export class BreachLookupError extends Error {
  override name = 'BreachLookupError'

  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
  }
}

export interface Breach {
  name: string
  title: string
  domain: string
  date: string
  dataClasses: string[]
}

export const RANGE_URL = 'https://api.pwnedpasswords.com/range/'
export const BREACHED_ACCOUNT_URL = 'https://haveibeenpwned.com/api/v3/breachedaccount/'

export async function sha1Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)]
    .map((one) => one.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

export function parseRange(body: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of body.split(/\r?\n/)) {
    const match = /^([0-9A-Fa-f]{35}):(\d+)\s*$/.exec(line)
    if (!match) continue
    const count = Number(match[2])
    if (count > 0) counts.set((match[1] ?? '').toUpperCase(), count)
  }
  return counts
}

async function fetched(
  url: string,
  headers: Record<string, string>,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<FetchedResponse> {
  try {
    return await fetcher(url, signal ? { headers, signal } : { headers })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new BreachLookupError(`Could not reach ${new URL(url).host}.`, null)
  }
}

function failure(host: string, status: number): BreachLookupError {
  if (status === 429)
    return new BreachLookupError(`${host} asks to wait before asking again.`, status)
  if (status === 401) return new BreachLookupError(`${host} did not take the API key.`, status)
  return new BreachLookupError(`${host} answered ${String(status)}.`, status)
}

export async function rangeOf(
  prefix: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  if (!/^[0-9A-F]{5}$/.test(prefix)) throw new Error('pass: a range is five upper-case hex digits')
  const response = await fetched(
    `${RANGE_URL}${prefix}`,
    { 'Add-Padding': 'true' },
    fetcher,
    signal,
  )
  if (!response.ok) throw failure('Have I Been Pwned', response.status)
  return parseRange(await response.text())
}

export async function pwnedCount(
  password: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<number> {
  const hash = await sha1Hex(password)
  const range = await rangeOf(hash.slice(0, 5), fetcher, signal)
  return range.get(hash.slice(5)) ?? 0
}

export interface CompromisedOptions {
  concurrency?: number
  signal?: AbortSignal
}

export async function compromisedOf(
  items: readonly Item[],
  fetcher: Fetcher,
  options: CompromisedOptions = {},
): Promise<Set<string>> {
  const { concurrency = 4, signal } = options
  const byPassword = new Map<string, string[]>()
  for (const item of watchedLogins(items)) {
    const password = item.content.password
    if (password === '') continue
    const ids = byPassword.get(password)
    if (ids) ids.push(item.id)
    else byPassword.set(password, [item.id])
  }
  const byPrefix = new Map<string, { suffix: string; ids: string[] }[]>()
  for (const [password, ids] of byPassword) {
    const hash = await sha1Hex(password)
    const prefix = hash.slice(0, 5)
    const wanted = byPrefix.get(prefix)
    const entry = { suffix: hash.slice(5), ids }
    if (wanted) wanted.push(entry)
    else byPrefix.set(prefix, [entry])
  }
  const compromised = new Set<string>()
  const prefixes = [...byPrefix.keys()]
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < prefixes.length) {
      signal?.throwIfAborted()
      const prefix = prefixes[next++] ?? ''
      const range = await rangeOf(prefix, fetcher, signal)
      for (const { suffix, ids } of byPrefix.get(prefix) ?? []) {
        if (range.has(suffix)) for (const id of ids) compromised.add(id)
      }
    }
  }
  signal?.throwIfAborted()
  const lanes = Math.max(1, Math.min(Math.floor(concurrency), prefixes.length))
  await Promise.all(Array.from({ length: lanes }, worker))
  return compromised
}

function breachOf(value: unknown): Breach | null {
  if (value === null || typeof value !== 'object') return null
  const one = value as Record<string, unknown>
  const text = (key: string): string => (typeof one[key] === 'string' ? one[key] : '')
  const name = text('Name')
  if (name === '') return null
  return {
    name,
    title: text('Title') || name,
    domain: text('Domain'),
    date: text('BreachDate'),
    dataClasses: Array.isArray(one.DataClasses)
      ? one.DataClasses.filter((c): c is string => typeof c === 'string')
      : [],
  }
}

export async function breachedAccount(
  email: string,
  apiKey: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<Breach[]> {
  const url = `${BREACHED_ACCOUNT_URL}${encodeURIComponent(email.trim())}?truncateResponse=false`
  const headers = { 'hibp-api-key': apiKey, 'user-agent': 'Orden' }
  const response = await fetched(url, headers, fetcher, signal)
  if (response.status === 404) return []
  if (!response.ok) throw failure('Have I Been Pwned', response.status)
  let body: unknown
  try {
    body = JSON.parse(await response.text())
  } catch {
    throw new BreachLookupError(
      'Have I Been Pwned answered something that is not JSON.',
      response.status,
    )
  }
  if (!Array.isArray(body)) {
    throw new BreachLookupError(
      'Have I Been Pwned answered something that is not a list.',
      response.status,
    )
  }
  return body.map(breachOf).filter((one): one is Breach => one !== null)
}
