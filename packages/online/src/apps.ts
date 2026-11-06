export function appSocketPath(app: string): string {
  return `/v2/apps/${encodeURIComponent(app)}/socket`
}

export const UNKNOWN_APP = 'no such application on this account'

export const HOST_PROTOCOL = 'nib.role.host'

export const MOST_SIGNAL = 64 * 1024

export interface View {
  width: number
  height: number
  dpr: number
  hz: number
}

export type AppState = 'stopped' | 'starting' | 'running' | 'exited'

const APP_STATES: readonly AppState[] = ['stopped', 'starting', 'running', 'exited']

export type NotStarted =
  'isolation' | 'display' | 'refused' | 'missing' | 'packaged' | 'handed' | 'failed'

export const NOT_STARTED: readonly NotStarted[] = [
  'isolation',
  'display',
  'refused',
  'missing',
  'packaged',
  'handed',
  'failed',
]

export interface StateFrame {
  t: 'state'
  state: AppState
  code?: number | null
  why?: NotStarted
}

export type ViewerFrame =
  | { t: 'hello'; hold?: true; view?: View }
  | { t: 'take' }
  | { t: 'leave' }
  | { t: 'signal'; data: string }
  | { t: 'view'; view: View }
  | { t: 'run'; what: 'start' | 'stop' | 'restart' }

export type HostFrame = { t: 'host' } | { t: 'signal'; data: string } | StateFrame

export type RelayToViewer =
  | { t: 'held'; by: string; since: number; taken: boolean }
  | { t: 'hold' }
  | { t: 'host'; up: boolean }
  | { t: 'signal'; data: string }
  | StateFrame
  | { t: 'refused'; error: 'gone' | 'rate' | 'large' }

export type RelayToHost =
  | { t: 'viewer'; device: string | null; name: string }
  | { t: 'signal'; data: string }
  | { t: 'view'; view: View }
  | { t: 'run'; what: 'start' | 'stop' | 'restart' }

type Fields = Record<string, unknown>

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function isSize(value: unknown, most: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= most
}

export function viewOf(value: unknown): View | null {
  if (!isRecord(value)) return null
  const { width, height, dpr, hz } = value
  if (!isSize(width, 16_384) || !isSize(height, 16_384) || !isSize(dpr, 8) || !isSize(hz, 500))
    return null
  return { width, height, dpr, hz }
}

function signalOf(value: Fields): { t: 'signal'; data: string } | null {
  return typeof value.data === 'string' && value.data.length <= MOST_SIGNAL
    ? { t: 'signal', data: value.data }
    : null
}

function runOf(value: Fields): { t: 'run'; what: 'start' | 'stop' | 'restart' } | null {
  const { what } = value
  return what === 'start' || what === 'stop' || what === 'restart' ? { t: 'run', what } : null
}

function stateOf(value: Fields): StateFrame | null {
  const { state, code, why } = value
  if (!APP_STATES.some((one) => one === state)) return null
  const known = state as AppState
  if (!(
    code === undefined ||
    code === null ||
    (typeof code === 'number' && Number.isSafeInteger(code))
  ))
    return null
  const reason = NOT_STARTED.find((one) => one === why)
  return {
    t: 'state',
    state: known,
    ...(code === undefined ? {} : { code }),
    ...(reason ? { why: reason } : {}),
  }
}

export function viewerFrameOf(raw: string): ViewerFrame | null {
  const value = parsed(raw)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'hello': {
      const view = value.view === undefined ? null : viewOf(value.view)
      if (value.view !== undefined && !view) return null
      return {
        t: 'hello',
        ...(value.hold === true ? { hold: true as const } : {}),
        ...(view ? { view } : {}),
      }
    }
    case 'take':
    case 'leave':
      return { t: value.t }
    case 'signal':
      return signalOf(value)
    case 'view': {
      const view = viewOf(value.view)
      return view ? { t: 'view', view } : null
    }
    case 'run':
      return runOf(value)
    default:
      return null
  }
}

export function hostFrameOf(raw: string): HostFrame | null {
  const value = parsed(raw)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'host':
      return { t: 'host' }
    case 'signal':
      return signalOf(value)
    case 'state':
      return stateOf(value)
    default:
      return null
  }
}

export function toViewerOf(raw: string): RelayToViewer | null {
  const value = parsed(raw)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'held': {
      const { by, since, taken } = value
      if (typeof by !== 'string' || by.length > 1024) return null
      if (typeof since !== 'number' || !Number.isFinite(since) || typeof taken !== 'boolean')
        return null
      return { t: 'held', by, since, taken }
    }
    case 'hold':
      return { t: 'hold' }
    case 'host':
      return typeof value.up === 'boolean' ? { t: 'host', up: value.up } : null
    case 'signal':
      return signalOf(value)
    case 'state':
      return stateOf(value)
    case 'refused': {
      const { error } = value
      return error === 'gone' || error === 'rate' || error === 'large'
        ? { t: 'refused', error }
        : null
    }
    default:
      return null
  }
}

export function toHostOf(raw: string): RelayToHost | null {
  const value = parsed(raw)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'viewer': {
      const { device, name } = value
      if (!(device === null || (typeof device === 'string' && device.length <= 200))) return null
      return typeof name === 'string' && name.length <= 1024 ? { t: 'viewer', device, name } : null
    }
    case 'signal':
      return signalOf(value)
    case 'view': {
      const view = viewOf(value.view)
      return view ? { t: 'view', view } : null
    }
    case 'run':
      return runOf(value)
    default:
      return null
  }
}

export const APP_EXTENSION = '.application'

export type AppRun =
  | { kind: 'installed'; id: string; name: string }
  | { kind: 'path'; path: string; args: string[]; cwd: string | null }

export interface AppFile {
  v: 1
  host: string
  run: AppRun
}

const LONGEST = 4096

function isText(value: unknown, most = LONGEST): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= most
}

function runOfFile(value: unknown): AppRun | null {
  if (!isRecord(value)) return null
  if (value.kind === 'installed') {
    return isText(value.id) && isText(value.name, 200)
      ? { kind: 'installed', id: value.id, name: value.name }
      : null
  }
  if (value.kind !== 'path' || !isText(value.path)) return null
  const args = value.args ?? []
  if (!Array.isArray(args) || args.length > 256 || !args.every((one) => typeof one === 'string'))
    return null
  const cwd = value.cwd ?? null
  if (!(cwd === null || isText(cwd))) return null
  return { kind: 'path', path: value.path, args, cwd }
}

export function appFileOf(text: string): AppFile | null {
  const value = parsed(text)
  if (!isRecord(value) || value.v !== 1 || !isText(value.host, 200)) return null
  const run = runOfFile(value.run)
  return run ? { v: 1, host: value.host, run } : null
}

export function appFileText(app: AppFile): string {
  const run =
    app.run.kind === 'installed'
      ? { kind: 'installed', id: app.run.id, name: app.run.name }
      : { kind: 'path', path: app.run.path, args: app.run.args, cwd: app.run.cwd }
  return `${JSON.stringify({ v: 1, host: app.host, run })}\n`
}

export interface Installed {
  id: string
  name: string
  icon?: string
}

export const MOST_INSTALLED = 2000
export const MOST_ICON = 48 * 1024
export const MOST_CATALOGUE = 1_900_000

const ICON = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/

export function installedOf(value: unknown): Installed | null {
  if (!isRecord(value) || !isText(value.id, 512) || !isText(value.name, 200)) return null
  const { icon } = value
  const kept = typeof icon === 'string' && icon.length <= MOST_ICON && ICON.test(icon)
  return { id: value.id, name: value.name, ...(kept ? { icon } : {}) }
}

export function catalogueOf(value: unknown): Installed[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const apps: Installed[] = []
  for (const one of value) {
    const app = installedOf(one)
    if (!app || seen.has(app.id)) continue
    seen.add(app.id)
    apps.push(app)
    if (apps.length === MOST_INSTALLED) break
  }
  return apps
}

export function fitCatalogue(apps: readonly Installed[], most = MOST_CATALOGUE): Installed[] {
  const fitted = [...apps]
  let length = JSON.stringify({ apps: fitted }).length
  for (let at = fitted.length - 1; at >= 0 && length > most; at--) {
    const one = fitted[at]
    if (!one?.icon) continue
    length -= JSON.stringify(one).length - JSON.stringify({ id: one.id, name: one.name }).length
    fitted[at] = { id: one.id, name: one.name }
  }
  return fitted
}

export const CATALOGUE_PATH = '/v2/apps/catalogue'

export type NoPicture = 'encoder' | 'offer' | 'network' | 'stopped'

const NO_PICTURE: readonly NoPicture[] = ['encoder', 'offer', 'network', 'stopped']

export interface CandidateLine {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
}

export type ToHost = { offer: string } | { candidate: CandidateLine } | { bye: true }

export function toHostText(said: ToHost): string {
  return JSON.stringify(said)
}

export type FromHost = { answer: string } | { cannot: NoPicture | null }

export function fromHostOf(data: string): FromHost | null {
  const value = parsed(data)
  if (!isRecord(value)) return null
  if (typeof value.answer === 'string') return { answer: value.answer }
  if (typeof value.cannot === 'string')
    return { cannot: NO_PICTURE.find((one) => one === value.cannot) ?? null }
  return null
}

export type InputEvent =
  | { t: 'move'; x: number; y: number }
  | { t: 'button'; button: number; down: boolean }
  | { t: 'wheel'; x: number; y: number }
  | { t: 'key'; key: string; code: string; down: boolean }
  | { t: 'text'; text: string }
  | { t: 'clipboard'; text: string }
  | { t: 'share'; clipboard: boolean }
  | { t: 'ping'; at: number }

export function inputText(event: InputEvent): string {
  return JSON.stringify(event)
}

export const MOST_POINTER = 256 * 1024

export const MOST_CLIPBOARD = 200 * 1024

export type FromPicture = PointerShape | { t: 'clipboard'; text: string } | Pong

export interface Pong {
  t: 'pong'
  at: number
  began: number
  now: number
  encoder: string | null
  hardware: boolean
  usage: Usage | null
}

export interface Usage {
  cpu: number
  memory: number
  gpu?: number
}

export function usageOf(value: unknown): Usage | null {
  if (!isRecord(value)) return null
  const { cpu, memory, gpu } = value
  if (!isTime(cpu) || !isTime(memory)) return null
  return { cpu, memory, ...(isTime(gpu) ? { gpu } : {}) }
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export type PointerShape =
  { t: 'pointer'; png: string; x: number; y: number } | { t: 'pointer'; hidden: true }

const POINTER_PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/

function isSpot(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1024
}

export function fromPictureOf(data: unknown): FromPicture | null {
  if (typeof data !== 'string' || data.length > MOST_POINTER + 1024) return null
  const value = parsed(data)
  if (!isRecord(value)) return null
  if (value.t === 'clipboard') {
    const { text } = value
    return typeof text === 'string' && text.length <= MOST_CLIPBOARD
      ? { t: 'clipboard', text }
      : null
  }
  if (value.t === 'pong') {
    const { at, began, now, encoder, hardware } = value
    if (!isTime(at) || !isTime(began) || !isTime(now)) return null
    const named = typeof encoder === 'string' && encoder.length <= 64 ? encoder : null
    return {
      t: 'pong',
      at,
      began,
      now,
      encoder: named,
      hardware: hardware === true,
      usage: usageOf(value.usage),
    }
  }
  if (value.t !== 'pointer') return null
  if (value.hidden === true) return { t: 'pointer', hidden: true }
  const { png, x, y } = value
  if (typeof png !== 'string' || png.length > MOST_POINTER || !POINTER_PNG.test(png)) return null
  return isSpot(x) && isSpot(y) ? { t: 'pointer', png, x, y } : null
}

export const ICE_PATH = '/v2/apps/ice'

export interface IceServer {
  urls: string[]
  username?: string
  credential?: string
}

export const FALLBACK_ICE: readonly IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }]

const ICE_URL = /^(stun|stuns|turn|turns):[^\s]{1,250}$/

export function iceServersOf(value: unknown): IceServer[] {
  const list = Array.isArray(value) ? value : isRecord(value) ? [value] : []
  const servers: IceServer[] = []
  for (const one of list.slice(0, 8)) {
    if (!isRecord(one)) continue
    const raw = Array.isArray(one.urls) ? one.urls : [one.urls]
    const urls = raw.filter((url): url is string => typeof url === 'string' && ICE_URL.test(url))
    if (urls.length === 0) continue
    const { username, credential } = one
    servers.push({
      urls: urls.slice(0, 8),
      ...(typeof username === 'string' && username.length <= 512 ? { username } : {}),
      ...(typeof credential === 'string' && credential.length <= 512 ? { credential } : {}),
    })
  }
  return servers
}
