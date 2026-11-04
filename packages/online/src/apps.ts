/** An application's socket (issue 1063): a desktop application running on one of the
 *  reader's devices, used as an Orden tab from any other, one device at a time.
 *
 *  Every party has one socket to the account's `AppRelay` for the application, at
 *  `GET /v2/apps/:app/socket`: the **host**, the device the application runs on (its
 *  subprotocol `nib.role.host`), and the **viewers**, every device with its tab open. The
 *  relay keeps the lock between the viewers - the online terminal's (issue 1055), with
 *  its frames `hello {hold}`, `take`, `leave`, `held` and `hold`, and its `HOLD_GRACE`
 *  and `HOLD_QUIET` (wire.ts) - and passes WebRTC's
 *  signalling between the holder and the host. The picture and the input go between
 *  those two directly, never through the relay.
 *
 *  As the online terminal's wire: JSON text frames, and a frame that does not check is
 *  dropped, so either side may be older than the other. */

/** The app socket's address for an application file's id. */
export function appSocketPath(app: string): string {
  return `/v2/apps/${encodeURIComponent(app)}/socket`
}

/** The subprotocol the host's socket names itself with. */
export const HOST_PROTOCOL = 'nib.role.host'

/** The largest signalling message: an SDP offer with many candidates is a few KB. */
export const MOST_SIGNAL = 64 * 1024

/** The tab's view on the holder's device, which the application's display is made to
 *  match: CSS pixels, the device pixel ratio, and the refresh rate. */
export interface View {
  width: number
  height: number
  dpr: number
  hz: number
}

/** Where the application is on its host. */
export type AppState = 'stopped' | 'starting' | 'running' | 'exited'

const APP_STATES: readonly AppState[] = ['stopped', 'starting', 'running', 'exited']

/** What a viewer says: hello (with `hold`, as an online terminal's), Take over, leave,
 *  signalling for the host, its view, and start / stop / restart for the host. */
export type ViewerFrame =
  | { t: 'hello'; hold?: true; view?: View }
  | { t: 'take' }
  | { t: 'leave' }
  | { t: 'signal'; data: string }
  | { t: 'view'; view: View }
  | { t: 'run'; what: 'start' | 'stop' | 'restart' }

/** What the host says: that it is the host, signalling for the holder, and where the
 *  application stands. */
export type HostFrame =
  | { t: 'host' }
  | { t: 'signal'; data: string }
  | { t: 'state'; state: AppState; code?: number | null }

/** What the relay tells a viewer: the lock's frames, whether the host is there, the
 *  host's signalling, where the application stands, and refusals. */
export type RelayToViewer =
  | { t: 'held'; by: string; since: number; taken: boolean }
  | { t: 'hold' }
  | { t: 'host'; up: boolean }
  | { t: 'signal'; data: string }
  | { t: 'state'; state: AppState; code?: number | null }
  | { t: 'refused'; error: 'gone' | 'rate' | 'large' }

/** What the relay tells the host: who holds the application now (null for nobody), the
 *  holder's signalling and view, and what the holder asked it to do. */
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
    // Not JSON: not a frame, and the caller drops it.
    return undefined
  }
}

function isSize(value: unknown, most: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= most
}

/** A view that checks: a screen no larger than 16K, a ratio up to 8, up to 500 Hz. */
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

function stateOf(value: Fields): { t: 'state'; state: AppState; code?: number | null } | null {
  const { state, code } = value
  if (!APP_STATES.some((one) => one === state)) return null
  const known = state as AppState
  if (code === undefined) return { t: 'state', state: known }
  return code === null || (typeof code === 'number' && Number.isSafeInteger(code))
    ? { t: 'state', state: known, code }
    : null
}

/** A viewer's frame, as the relay reads it. */
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

/** The host's frame, as the relay reads it. */
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

/** The relay's frame, as a viewer reads it. */
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

/** The relay's frame, as the host reads it. */
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

// ---------------------------------------------------------------------------
// The file

/** The extension an application's file has: its own word, since a `.app` is a folder on
 *  a Mac and Finder would draw the file as a broken bundle. */
export const APP_EXTENSION = '.application'

/** What an application runs: one installed on its host, by the id the host lists it
 *  under and the name it was shown with; or a program by its path, with its arguments
 *  and the folder it starts in. */
export type AppRun =
  | { kind: 'installed'; id: string; name: string }
  | { kind: 'path'; path: string; args: string[]; cwd: string | null }

/** An application's file: the device it runs on, and what it runs there. */
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

/** An application file's text as its fields, or null for text that is not one: read
 *  strictly, as a `.term` is, and extra fields dropped. */
export function appFileOf(text: string): AppFile | null {
  const value = parsed(text)
  if (!isRecord(value) || value.v !== 1 || !isText(value.host, 200)) return null
  const run = runOfFile(value.run)
  return run ? { v: 1, host: value.host, run } : null
}

/** The text an application's file is written with: one line of JSON and a newline. */
export function appFileText(app: AppFile): string {
  const run =
    app.run.kind === 'installed'
      ? { kind: 'installed', id: app.run.id, name: app.run.name }
      : { kind: 'path', path: app.run.path, args: app.run.args, cwd: app.run.cwd }
  return `${JSON.stringify({ v: 1, host: app.host, run })}\n`
}
