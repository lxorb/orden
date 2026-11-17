import {
  type Allowance,
  type Disk,
  type HostKind,
  type MachineState,
  type Term,
  termOf,
} from '@orden/online'
import { account, ApiError, request } from '../../../accounts/src/api'
import { isNumber, isRecord, isString } from '../../../platform/src/api'

export interface ServerInfo {
  type: string
  location: string | null
  cores: number
  memoryGb: number
  diskGb: number
  price: number | null
  hourly: number | null
  currency: string | null
  made: boolean
  spent: number | null
}

export interface Offer {
  name: string
  cores: number
  memoryGb: number
  diskGb: number
  cpu: 'shared' | 'dedicated'
  arch: 'x86' | 'arm'
  prices: { location: string; monthly: number; hourly: number }[]
}

interface Place {
  name: string
  city: string
  country: string
}

export interface Offers {
  currency: string
  locations: Place[]
  types: Offer[]
}

interface MachineInfo {
  id: string
  state: MachineState
  held: boolean
  host: HostKind
  server: ServerInfo | null
  disk: Disk | null
}

export interface Online {
  allowed: boolean
  machine: MachineInfo | null
  used: Allowance
  limit: Allowance
  resets: number
}

export type Refused =
  'signed-out' | 'list' | 'allowance' | 'budget' | 'off' | 'flag' | 'sessions' | 'other'

const STATES: readonly MachineState[] = ['asleep', 'starting', 'awake', 'stopping']

function allowanceOf(value: unknown): Allowance | null {
  if (!isRecord(value)) return null
  const { awakeS, cpuS, homeBytes, egressBytes } = value
  if (!isNumber(awakeS) || !isNumber(cpuS) || !isNumber(homeBytes) || !isNumber(egressBytes))
    return null
  return { awakeS, cpuS, homeBytes, egressBytes }
}

function serverOf(value: unknown): ServerInfo | null {
  if (!isRecord(value) || !isString(value.type)) return null
  const { cores, memoryGb, diskGb, price, hourly, currency, spent } = value
  if (!isNumber(cores) || !isNumber(memoryGb) || !isNumber(diskGb)) return null
  return {
    type: value.type,
    location: isString(value.location) && value.location ? value.location : null,
    cores,
    memoryGb,
    diskGb,
    price: isNumber(price) ? price : null,
    hourly: isNumber(hourly) ? hourly : null,
    currency: isString(currency) ? currency : null,
    made: value.made !== false,
    spent: isNumber(spent) ? spent : null,
  }
}

function offerOf(value: unknown): Offer | null {
  if (!isRecord(value) || !isString(value.name) || !Array.isArray(value.prices)) return null
  const { cores, memoryGb, diskGb } = value
  if (!isNumber(cores) || !isNumber(memoryGb) || !isNumber(diskGb)) return null
  const prices = value.prices.flatMap((one: unknown) =>
    isRecord(one) && isString(one.location) && isNumber(one.monthly) && isNumber(one.hourly)
      ? [{ location: one.location, monthly: one.monthly, hourly: one.hourly }]
      : [],
  )
  return {
    name: value.name,
    cores,
    memoryGb,
    diskGb,
    cpu: value.cpu === 'dedicated' ? 'dedicated' : 'shared',
    arch: value.arch === 'arm' ? 'arm' : 'x86',
    prices,
  }
}

export function offersOf(value: unknown): Offers | null {
  if (!isRecord(value) || !isString(value.currency)) return null
  if (!Array.isArray(value.types) || !Array.isArray(value.locations)) return null
  return {
    currency: value.currency,
    locations: value.locations.flatMap((one: unknown) =>
      isRecord(one) && isString(one.name)
        ? [
            {
              name: one.name,
              city: isString(one.city) ? one.city : cityOf(one.name),
              country: isString(one.country) ? one.country : '',
            },
          ]
        : [],
    ),
    types: value.types.flatMap((one: unknown) => offerOf(one) ?? []),
  }
}

function diskOf(value: unknown): Disk | null {
  if (!isRecord(value) || !isNumber(value.used) || !isNumber(value.total)) return null
  return { used: value.used, total: value.total }
}

function machineOf(value: unknown): MachineInfo | null {
  if (!isRecord(value) || !isString(value.id)) return null
  const state = STATES.find((one) => one === value.state)
  if (!state) return null
  return {
    id: value.id,
    state,
    held: value.held === true,
    host: value.host === 'hetzner' ? 'hetzner' : 'cloudflare',
    server: serverOf(value.server),
    disk: diskOf(value.disk),
  }
}

const CITIES: Record<string, string> = {
  nbg1: 'Nuremberg',
  fsn1: 'Falkenstein',
  hel1: 'Helsinki',
  ash: 'Ashburn',
  hil: 'Hillsboro',
  sin: 'Singapore',
}

export function cityOf(location: string): string {
  return CITIES[location] ?? location
}

export function onlineOf(value: unknown): Online | null {
  if (!isRecord(value)) return null
  const used = allowanceOf(value.used)
  const limit = allowanceOf(value.limit)
  if (!used || !limit || !isNumber(value.resetAt)) return null
  return {
    allowed: value.allowed === true,
    machine: machineOf(value.machine),
    used,
    limit,
    resets: value.resetAt,
  }
}

const REFUSALS: readonly Refused[] = ['list', 'allowance', 'budget', 'off', 'flag', 'sessions']

export function refusedOf(error: unknown): Refused {
  if (!(error instanceof ApiError)) return 'other'
  if (error.status === 401) return 'signed-out'
  if (error.status === 404) return 'off'
  const said = isRecord(error.body) && isString(error.body.error) ? error.body.error : ''
  return REFUSALS.find((one) => one === said) ?? 'other'
}

function token(): string {
  const now = account.accountToken
  if (!now) throw new ApiError(401, 'signed out')
  return now
}

export async function online(): Promise<Online | null> {
  return onlineOf(await request<unknown>('/v2/online/machine', { token: token() }))
}

export async function termSession(term: string | null, session?: string): Promise<Term> {
  const said = await request<unknown>('/v2/online/terms', {
    method: 'POST',
    token: token(),
    body: term === null ? {} : { term, ...(session ? { session } : {}) },
  })
  const found = termOf(JSON.stringify(said))
  if (!found) throw new ApiError(500, 'no session')
  return found
}

export async function offers(): Promise<Offers | null> {
  try {
    return offersOf(await request<unknown>('/v2/online/types', { token: token() }))
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export type Refit = 'disk' | 'arch' | 'busy' | 'budget' | 'type' | 'other'

export function refitOf(error: unknown): Refit {
  const said =
    error instanceof ApiError && isRecord(error.body) && isString(error.body.error)
      ? error.body.error
      : ''
  return (
    (['disk', 'arch', 'busy', 'budget', 'type'] as const).find((one) => one === said) ?? 'other'
  )
}

export async function chooseType(type: string, location: string | null): Promise<void> {
  await request<unknown>('/v2/online/machine/type', {
    method: 'POST',
    token: token(),
    body: { type, ...(location ? { location } : {}) },
  })
}

export async function startStop(start: boolean): Promise<void> {
  await request<unknown>(`/v2/online/machine/${start ? 'start' : 'stop'}`, {
    method: 'POST',
    token: token(),
  })
}

export interface Listed {
  term: string | null
  session: string
  createdAt: number | null
  space: string | null
  path: string | null
  trashed: boolean
  program: string | null
  title: string | null
  alive: boolean | null
  at: number | null
}

const orNull = <T>(value: unknown, is: (one: unknown) => one is T): T | null =>
  is(value) ? value : null

function listedOf(value: unknown): Listed | null {
  if (!isRecord(value) || !isString(value.session)) return null
  return {
    term: orNull(value.term, isString),
    session: value.session,
    createdAt: orNull(value.createdAt, isNumber),
    space: orNull(value.space, isString),
    path: orNull(value.path, isString),
    trashed: value.trashed === true,
    program: orNull(value.program, isString),
    title: orNull(value.title, isString),
    alive: typeof value.alive === 'boolean' ? value.alive : null,
    at: orNull(value.at, isNumber),
  }
}

export function listOf(value: unknown): Listed[] {
  if (!isRecord(value) || !Array.isArray(value.terms)) return []
  return value.terms.flatMap((one) => {
    const read = listedOf(one)
    return read ? [read] : []
  })
}

export async function listed(): Promise<Listed[]> {
  return listOf(await request<unknown>('/v2/online/terms', { token: token() }))
}

export async function endSession(id: string): Promise<void> {
  await request<unknown>(`/v2/online/terms/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token: token(),
  })
}
