import {
  type Allowance,
  type Disk,
  type HostKind,
  type MachineState,
  type Term,
  termOf,
} from '@orden/online'
import { account } from '../account.svelte'
import { ApiError, request } from '../api'
import { isNumber, isRecord, isString } from '../stored'

interface ServerInfo {
  type: string
  location: string | null
  cores: number
  memoryGb: number
  diskGb: number
  price: number | null
  currency: string | null
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
  const { cores, memoryGb, diskGb, price, currency } = value
  if (!isNumber(cores) || !isNumber(memoryGb) || !isNumber(diskGb)) return null
  return {
    type: value.type,
    location: isString(value.location) && value.location ? value.location : null,
    cores,
    memoryGb,
    diskGb,
    price: isNumber(price) ? price : null,
    currency: isString(currency) ? currency : null,
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
