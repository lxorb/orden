import { withOrWithout, isRecord, isString } from '../../platform/src/api'
import { isLocal, type Provider, type ProviderKind } from './providers'

export type Vendor = string

export const CLAUDE: Vendor = 'claude'
export const OPENAI: Vendor = 'openai'
export const GEMINI: Vendor = 'gemini'

export interface Account extends Provider {
  own?: true
}

export interface Accounts {
  accounts: Account[]
  active: Record<Vendor, string>
  defaultVendor: Vendor
  uses: Record<string, Vendor>
}

export const NONE: Accounts = { accounts: [], active: {}, defaultVendor: '', uses: {} }

const FIRST: Record<Exclude<ProviderKind, 'compatible'>, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'gemini',
  chatgpt: 'chatgpt',
  'claude-code': 'claude-code',
  codex: 'codex',
  'gemini-cli': 'gemini-cli',
}

export function repeatable(kind: ProviderKind): boolean {
  return kind !== 'chatgpt'
}

export function vendorOf(account: Pick<Provider, 'id' | 'kind'>): Vendor {
  switch (account.kind) {
    case 'anthropic':
    case 'claude-code':
      return CLAUDE
    case 'openai':
    case 'chatgpt':
    case 'codex':
      return OPENAI
    case 'gemini':
    case 'gemini-cli':
      return GEMINI
    case 'compatible':
      return account.id
  }
}

function isKind(value: unknown): value is ProviderKind {
  if (value === 'claude-code' && !__CLAUDE_CODE__) return false
  return value === 'compatible' || (isString(value) && value in FIRST)
}

function isId(value: unknown): value is string {
  return isString(value) && /^[A-Za-z0-9_-]{1,64}$/.test(value)
}

function accountIn(value: unknown): Account | null {
  if (!isRecord(value)) return null
  const { id, kind, name, baseUrl, model, own } = value
  if (!isId(id) || !isKind(kind) || !isString(name)) return null

  return {
    id,
    kind,
    name,
    ...(isString(baseUrl) ? { baseUrl } : {}),
    model: isString(model) ? model : '',
    ...(own === true && isLocal(kind) ? { own: true as const } : {}),
  }
}

function namesIn(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => isString(entry[1])),
  )
}

export function accountsIn(value: unknown): Accounts {
  if (!isRecord(value)) return NONE
  const seen = new Set<string>()
  const accounts = (Array.isArray(value.accounts) ? value.accounts : [])
    .map(accountIn)
    .filter((one): one is Account => {
      if (!one || seen.has(one.id)) return false
      seen.add(one.id)
      return true
    })
  return tidied({
    accounts,
    active: namesIn(value.active),
    defaultVendor: isString(value.defaultVendor) ? value.defaultVendor : '',
    uses: namesIn(value.uses),
  })
}

export function accountsText(state: Accounts): string {
  return JSON.stringify({
    version: 1,
    accounts: state.accounts,
    active: state.active,
    defaultVendor: state.defaultVendor,
    uses: state.uses,
  })
}

export function vendors(state: Accounts): Vendor[] {
  const all = [...new Set(state.accounts.map(vendorOf))]
  const rank = (one: Vendor) => (one === CLAUDE ? 0 : one === OPENAI ? 1 : one === GEMINI ? 2 : 3)
  return all.sort((a, b) => rank(a) - rank(b))
}

export function accountsOf(state: Accounts, vendor: Vendor): Account[] {
  return state.accounts.filter((one) => vendorOf(one) === vendor)
}

export function activeOf(state: Accounts, vendor: Vendor): Account | null {
  const mine = accountsOf(state, vendor)
  return mine.find((one) => one.id === state.active[vendor]) ?? mine[0] ?? null
}

export function defaultOf(state: Accounts): Account | null {
  return activeOf(state, state.defaultVendor)
}

export function actives(state: Accounts): Account[] {
  return vendors(state)
    .map((vendor) => activeOf(state, vendor))
    .filter((one): one is Account => one !== null)
}

function vendorNamed(state: Accounts, id: string): Vendor | null {
  const account = state.accounts.find((one) => one.id === id)
  if (account) return vendorOf(account)
  return state.accounts.some((one) => vendorOf(one) === id) ? id : null
}

export function resolve(state: Accounts, id: string): Account | null {
  const vendor = vendorNamed(state, id)
  return vendor === null ? null : activeOf(state, vendor)
}

export function isActive(state: Accounts, id: string): boolean {
  const account = state.accounts.find((one) => one.id === id)
  return !!account && activeOf(state, vendorOf(account))?.id === id
}

function nextId(state: Accounts, kind: ProviderKind): string {
  const taken = (id: string) => state.accounts.some((one) => one.id === id)
  if (kind !== 'compatible' && !taken(FIRST[kind])) return FIRST[kind]
  const stem = kind === 'compatible' ? 'compatible' : FIRST[kind]
  for (let number = kind === 'compatible' ? 1 : 2; ; number++) {
    const id = `${stem}-${number}`
    if (!taken(id)) return id
  }
}

function tidied(state: Accounts): Accounts {
  const there = vendors(state)
  const active: Record<Vendor, string> = {}
  for (const vendor of there) {
    const chosen = state.active[vendor]
    const mine = accountsOf(state, vendor)
    const kept = mine.find((one) => one.id === chosen) ?? mine[0]
    if (kept) active[vendor] = kept.id
  }
  return {
    accounts: state.accounts,
    active,
    defaultVendor: there.includes(state.defaultVendor) ? state.defaultVendor : (there[0] ?? ''),
    uses: Object.fromEntries(Object.entries(state.uses).filter(([, one]) => there.includes(one))),
  }
}

export function added(state: Accounts, kind: ProviderKind): { state: Accounts; account: Account } {
  const held = repeatable(kind) ? undefined : state.accounts.find((one) => one.kind === kind)
  if (held) return { state, account: held }

  const id = nextId(state, kind)
  const account: Account = {
    id,
    kind,
    name: '',
    ...(kind === 'compatible' ? { baseUrl: '' } : {}),
    model: '',
    ...(isLocal(kind) && state.accounts.some((one) => one.kind === kind)
      ? { own: true as const }
      : {}),
  }
  return { state: including(state, account), account }
}

export function including(state: Accounts, account: Account): Accounts {
  if (state.accounts.some((one) => one.id === account.id)) return state
  return tidied({ ...state, accounts: [...state.accounts, account] })
}

export function updated(
  state: Accounts,
  id: string,
  change: Partial<Omit<Account, 'id' | 'kind' | 'own'>>,
): Accounts {
  return {
    ...state,
    accounts: state.accounts.map((one) => (one.id === id ? { ...one, ...change } : one)),
  }
}

export function removed(state: Accounts, id: string): Accounts {
  return tidied({ ...state, accounts: state.accounts.filter((one) => one.id !== id) })
}

export function activated(state: Accounts, id: string): Accounts {
  const account = state.accounts.find((one) => one.id === id)
  if (!account) return state
  return { ...state, active: { ...state.active, [vendorOf(account)]: id } }
}

export function defaulted(state: Accounts, id: string): Accounts {
  const vendor = vendorNamed(state, id)
  if (vendor === null) return state
  return { ...activated(state, id), defaultVendor: vendor }
}

export function used(state: Accounts, feature: string, id: string): Accounts {
  const vendor = id ? vendorNamed(state, id) : null
  return { ...state, uses: withOrWithout(state.uses, feature, vendor) }
}

export function migrated(old: unknown): Accounts {
  if (!isRecord(old)) return NONE
  const accounts = accountsIn({ accounts: old.providers }).accounts
  const state: Accounts = { accounts, active: {}, defaultVendor: '', uses: {} }
  const named = (id: unknown) => (isString(id) ? vendorNamed(state, id) : null)

  const active: Record<Vendor, string> = {}
  const defaultId = isString(old.defaultId) ? old.defaultId : ''
  const fallback = accounts.find((one) => one.id === defaultId)
  if (fallback) active[vendorOf(fallback)] = fallback.id

  const uses: Record<string, Vendor> = {}
  for (const [feature, id] of Object.entries(namesIn(old.uses))) {
    const vendor = named(id)
    if (vendor !== null) uses[feature] = vendor
  }
  return tidied({ accounts, active, defaultVendor: named(defaultId) ?? '', uses })
}

export function merged(kept: Accounts, brought: Accounts): Accounts {
  const fresh = brought.accounts.filter(
    (one) => !kept.accounts.some((there) => there.id === one.id),
  )
  if (!fresh.length) return kept
  return tidied({
    ...kept,
    accounts: [...kept.accounts, ...fresh],
    defaultVendor: kept.defaultVendor || brought.defaultVendor,
  })
}
