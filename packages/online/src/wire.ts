import { frame, unframe } from '@orden/sync-core/wire'
import type { Activity, MachineState, SleepReason } from './types'
import { isLoopbackUrl, isWebUrl } from './urls'

export const MOST_SOCKETS = 25
export const MOST_SESSIONS = 8
export const INPUT_RATE = 100
export const MOST_INPUT = 64 * 1024
export const MOST_BEHIND = 1024 * 1024
export const KEPT_OUTPUT = 1024 * 1024
export const SCROLLBACK = 5000
export const MOST_CELLS = 1000

export function inputChunks(data: string, most = MOST_INPUT): string[] {
  const chunks: string[] = []
  let from = 0
  let bytes = 0
  for (let at = 0; at < data.length;) {
    const code = data.codePointAt(at) ?? 0
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (bytes + size > most && at > from) {
      chunks.push(data.slice(from, at))
      from = at
      bytes = 0
    }
    bytes += size
    at += code > 0xffff ? 2 : 1
  }
  if (from < data.length || chunks.length === 0) chunks.push(data.slice(from))
  return chunks
}

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp'

export const IMAGE_KINDS: readonly ImageKind[] = ['png', 'jpeg', 'gif', 'webp']

export const MOST_IMAGE = 16 * 1024 * 1024

export const IMAGE_PART = (MOST_INPUT / 4) * 3

export function isImageId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]{16,64}$/.test(value)
}

export function socketPath(term: string): string {
  return `/v2/online/${encodeURIComponent(term)}/socket`
}

export type Refusal =
  'gone' | 'role' | 'list' | 'allowance' | 'budget' | 'off' | 'flag' | 'sessions' | 'rate' | 'large'

export const REFUSALS: readonly Refusal[] = [
  'gone',
  'role',
  'list',
  'allowance',
  'budget',
  'off',
  'flag',
  'sessions',
  'rate',
  'large',
]

export type DownReason = SleepReason | 'flag' | 'stopped' | 'restart'

const DOWN_REASONS: readonly DownReason[] = [
  'idle',
  'allowance',
  'budget',
  'off',
  'flag',
  'stopped',
  'restart',
]

const MACHINE_STATES: readonly MachineState[] = ['asleep', 'starting', 'awake', 'stopping']

export interface Restored {
  at: number
  program: string | null
}

export interface Person {
  who: string
  device: string
  typing: boolean
}

export type ClientFrame =
  | { t: 'hello'; since?: number; cols: number; rows: number; hold?: true }
  | { t: 'take' }
  | { t: 'leave' }
  | { t: 'in'; data: string }
  | { t: 'size'; cols: number; rows: number }
  | { t: 'start' }
  | { t: 'resume' }
  | { t: 'callback'; url: string }
  | { t: 'image'; id: string; kind: ImageKind; part: string; last: boolean }

export type ServerFrame =
  | {
      t: 'screen'
      seq: number
      cols: number
      rows: number
      data: string
      restored?: Restored
    }
  | { t: 'size'; cols: number; rows: number; by: string | null }
  | { t: 'people'; people: Person[] }
  | { t: 'typed'; who: string; seq: number }
  | { t: 'program'; name: string | null; title: string | null; mark: string | null }
  | { t: 'machine'; state: MachineState; reason?: DownReason }
  | { t: 'link'; up: boolean }
  | { t: 'role'; type: boolean }
  | { t: 'ended'; code: number | null }
  | { t: 'refused'; error: Refusal }
  | { t: 'browse'; url: string }
  | { t: 'called'; url: string; status: number }
  | { t: 'image'; id: string; path: string | null }
  | { t: 'note'; note: Note }
  | { t: 'held'; by: string; since: number; taken: boolean }
  | { t: 'hold' }

export const HOLD_GRACE = 30_000
export const HOLD_QUIET = 45_000

export type Note = 'restore' | 'disk'

const NOTES: readonly Note[] = ['restore', 'disk']

export function text(value: ClientFrame | ServerFrame): string {
  return JSON.stringify(value)
}

export function outFrame(seq: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length)
  new DataView(out.buffer).setFloat64(0, seq)
  out.set(data, 8)
  return out
}

export function outOf(bytes: Uint8Array): { seq: number; data: Uint8Array } | null {
  if (bytes.length < 8) return null
  const seq = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0)
  return isCount(seq) ? { seq, data: bytes.subarray(8) } : null
}

export type MachineFrame =
  | { t: 'open'; session: string; cols: number; rows: number; watching?: true }
  | { t: 'in'; session: string; data: Uint8Array }
  | { t: 'size'; session: string; cols: number; rows: number }
  | { t: 'want'; session: string; since: number }
  | { t: 'close'; session: string }
  | { t: 'sleep' }
  | { t: 'callback'; session: string; url: string }
  | { t: 'image'; session: string; id: string; kind: ImageKind; data: Uint8Array; last: boolean }
  | { t: 'ping' }
  | { t: 'restart' }
  | { t: 'list' }

export interface SessionNow {
  session: string
  program: string | null
  title: string | null
  alive: boolean
  at: number | null
}

const MOST_LISTED = 64

export type NibdFrame =
  | { t: 'out'; session: string; seq: number; data: Uint8Array }
  | {
      t: 'screen'
      session: string
      seq: number
      cols: number
      rows: number
      data: string
      restored?: Restored
    }
  | {
      t: 'program'
      session: string
      name: string | null
      title: string | null
      mark: string | null
    }
  | { t: 'ended'; session: string; code: number | null }
  | { t: 'activity'; activity: Activity }
  | { t: 'saved' }
  | { t: 'browse'; session: string; url: string }
  | { t: 'called'; session: string; url: string; status: number }
  | { t: 'image'; session: string; id: string; path: string | null }
  | { t: 'pong' }
  | { t: 'sessions'; sessions: SessionNow[] }

export const PING_EVERY = 5_000
export const QUIET_FOR = 20_000

export const SILENT_FOR = 40_000

export function linkFrame(value: MachineFrame | NibdFrame): Uint8Array {
  return frame(value)
}

const LONGEST_ID = 200
const LONGEST_TITLE = 1024
const MOST_SCREEN = 32 * 1024 * 1024

type Fields = Record<string, unknown>

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= LONGEST_ID
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCells(value: unknown): value is number {
  return isCount(value) && value >= 1 && value <= MOST_CELLS
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isShort(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= LONGEST_TITLE)
}

function isCode(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value))
}

function isScreen(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MOST_SCREEN
}

function isStatus(value: unknown): value is number {
  return isCount(value) && value <= 999
}

function isPathOrNone(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' && value.startsWith('/') && value.length <= LONGEST_TITLE)
  )
}

function isPart(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MOST_INPUT && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
}

function oneOf<T>(list: readonly T[], value: unknown): value is T {
  return list.some((one) => one === value)
}

function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function restoredOf(value: unknown): Restored | null {
  if (!isRecord(value) || !isTime(value.at) || !isShort(value.program)) return null
  return { at: value.at, program: value.program }
}

function screenOf(
  value: Fields,
): { seq: number; cols: number; rows: number; data: string; restored?: Restored } | null {
  const { seq, cols, rows, data } = value
  if (!isCount(seq) || !isCells(cols) || !isCells(rows) || !isScreen(data)) return null
  if (value.restored === undefined) return { seq, cols, rows, data }
  const restored = restoredOf(value.restored)
  return restored ? { seq, cols, rows, data, restored } : null
}

function sessionNowOf(value: unknown): SessionNow | null {
  if (!isRecord(value)) return null
  const { session, program, title, alive, at } = value
  if (!isId(session) || !isShort(program) || !isShort(title) || typeof alive !== 'boolean')
    return null
  return at === null || isCount(at) ? { session, program, title, alive, at } : null
}

function programOf(
  value: Fields,
): { name: string | null; title: string | null; mark: string | null } | null {
  const { name, title, mark } = value
  if (!isShort(name) || !isShort(title) || !(mark === null || isId(mark))) return null
  return { name, title, mark }
}

function personOf(value: unknown): Person | null {
  if (!isRecord(value) || !isId(value.who) || !isId(value.device)) return null
  if (typeof value.typing !== 'boolean') return null
  return { who: value.who, device: value.device, typing: value.typing }
}

function activityOf(value: unknown): Activity | null {
  if (!isRecord(value)) return null
  const { at, output, cpu, net, homeBytes, disk } = value
  if (!isTime(at) || !isCount(output) || !isCount(net) || !isCount(homeBytes)) return null
  if (typeof cpu !== 'number' || !Number.isFinite(cpu) || cpu < 0) return null
  if (disk === undefined) return { at, output, cpu, net, homeBytes }
  if (!isRecord(disk) || !isCount(disk.used) || !isCount(disk.total)) return null
  return { at, output, cpu, net, homeBytes, disk: { used: disk.used, total: disk.total } }
}

export function clientFrameOf(raw: string): ClientFrame | null {
  const value = parsed(raw)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'hello': {
      const { since, cols, rows } = value
      if (!isCells(cols) || !isCells(rows)) return null
      if (since !== undefined && !isCount(since)) return null
      return {
        t: 'hello',
        ...(since === undefined ? {} : { since }),
        cols,
        rows,
        ...(value.hold === true ? { hold: true as const } : {}),
      }
    }
    case 'take':
    case 'leave':
      return { t: value.t }
    case 'in':
      return typeof value.data === 'string' && value.data.length <= MOST_INPUT
        ? { t: 'in', data: value.data }
        : null
    case 'size':
      return isCells(value.cols) && isCells(value.rows)
        ? { t: 'size', cols: value.cols, rows: value.rows }
        : null
    case 'start':
    case 'resume':
      return { t: value.t }
    case 'callback':
      return isLoopbackUrl(value.url) ? { t: 'callback', url: value.url } : null
    case 'image': {
      const { id, kind, part, last } = value
      if (!isImageId(id) || !oneOf(IMAGE_KINDS, kind) || !isPart(part)) return null
      return typeof last === 'boolean' ? { t: 'image', id, kind, part, last } : null
    }
    default:
      return null
  }
}

export function serverFrameOf(raw: string): ServerFrame | null {
  const value = parsed(raw)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'screen': {
      const screen = screenOf(value)
      return screen ? { t: 'screen', ...screen } : null
    }
    case 'size': {
      const { cols, rows, by } = value
      if (!isCells(cols) || !isCells(rows) || !(by === null || isId(by))) return null
      return { t: 'size', cols, rows, by }
    }
    case 'people': {
      if (!Array.isArray(value.people) || value.people.length > MOST_SOCKETS) return null
      const people: Person[] = []
      for (const one of value.people) {
        const person = personOf(one)
        if (!person) return null
        people.push(person)
      }
      return { t: 'people', people }
    }
    case 'typed':
      return isId(value.who) && isCount(value.seq)
        ? { t: 'typed', who: value.who, seq: value.seq }
        : null
    case 'program': {
      const program = programOf(value)
      return program ? { t: 'program', ...program } : null
    }
    case 'machine': {
      const { state, reason } = value
      if (!oneOf(MACHINE_STATES, state)) return null
      if (reason === undefined) return { t: 'machine', state }
      return oneOf(DOWN_REASONS, reason) ? { t: 'machine', state, reason } : null
    }
    case 'link':
      return typeof value.up === 'boolean' ? { t: 'link', up: value.up } : null
    case 'role':
      return typeof value.type === 'boolean' ? { t: 'role', type: value.type } : null
    case 'ended':
      return isCode(value.code) ? { t: 'ended', code: value.code } : null
    case 'refused':
      return oneOf(REFUSALS, value.error) ? { t: 'refused', error: value.error } : null
    case 'browse':
      return isWebUrl(value.url) ? { t: 'browse', url: value.url } : null
    case 'called':
      return isLoopbackUrl(value.url) && isStatus(value.status)
        ? { t: 'called', url: value.url, status: value.status }
        : null
    case 'image':
      return isImageId(value.id) && isPathOrNone(value.path)
        ? { t: 'image', id: value.id, path: value.path }
        : null
    case 'note':
      return oneOf(NOTES, value.note) ? { t: 'note', note: value.note } : null
    case 'held': {
      const { by, since, taken } = value
      if (typeof by !== 'string' || by.length > LONGEST_TITLE || !isTime(since)) return null
      return typeof taken === 'boolean' ? { t: 'held', by, since, taken } : null
    }
    case 'hold':
      return { t: 'hold' }
    default:
      return null
  }
}

export function machineFrameOf(bytes: Uint8Array): MachineFrame | null {
  const value = unframe(bytes)
  if (!isRecord(value)) return null
  if (value.t === 'sleep' || value.t === 'ping' || value.t === 'restart' || value.t === 'list')
    return { t: value.t }

  const { session } = value
  if (!isId(session)) return null
  switch (value.t) {
    case 'open':
      if (!isCells(value.cols) || !isCells(value.rows)) return null
      return {
        t: 'open',
        session,
        cols: value.cols,
        rows: value.rows,
        ...(value.watching === true ? { watching: true as const } : {}),
      }
    case 'size':
      return isCells(value.cols) && isCells(value.rows)
        ? { t: 'size', session, cols: value.cols, rows: value.rows }
        : null
    case 'in':
      return value.data instanceof Uint8Array && value.data.length <= MOST_INPUT
        ? { t: 'in', session, data: value.data }
        : null
    case 'want':
      return isCount(value.since) ? { t: 'want', session, since: value.since } : null
    case 'close':
      return { t: 'close', session }
    case 'callback':
      return isLoopbackUrl(value.url) ? { t: 'callback', session, url: value.url } : null
    case 'image': {
      const { id, kind, data, last } = value
      if (!isImageId(id) || !oneOf(IMAGE_KINDS, kind) || typeof last !== 'boolean') return null
      return data instanceof Uint8Array && data.length <= IMAGE_PART
        ? { t: 'image', session, id, kind, data, last }
        : null
    }
    default:
      return null
  }
}

export function nibdFrameOf(bytes: Uint8Array): NibdFrame | null {
  const value = unframe(bytes)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'activity': {
      const activity = activityOf(value.activity)
      return activity ? { t: 'activity', activity } : null
    }
    case 'saved':
    case 'pong':
      return { t: value.t }
    case 'sessions': {
      const { sessions } = value
      if (!Array.isArray(sessions) || sessions.length > MOST_LISTED) return null
      const read = sessions.map(sessionNowOf)
      return read.every((one) => one !== null) ? { t: 'sessions', sessions: read } : null
    }
    default:
      break
  }

  const { session } = value
  if (!isId(session)) return null
  switch (value.t) {
    case 'out':
      return isCount(value.seq) && value.data instanceof Uint8Array
        ? { t: 'out', session, seq: value.seq, data: value.data }
        : null
    case 'screen': {
      const screen = screenOf(value)
      return screen ? { t: 'screen', session, ...screen } : null
    }
    case 'program': {
      const program = programOf(value)
      return program ? { t: 'program', session, ...program } : null
    }
    case 'ended':
      return isCode(value.code) ? { t: 'ended', session, code: value.code } : null
    case 'browse':
      return isWebUrl(value.url) ? { t: 'browse', session, url: value.url } : null
    case 'called':
      return isLoopbackUrl(value.url) && isStatus(value.status)
        ? { t: 'called', session, url: value.url, status: value.status }
        : null
    case 'image':
      return isImageId(value.id) && isPathOrNone(value.path)
        ? { t: 'image', session, id: value.id, path: value.path }
        : null
    default:
      return null
  }
}
