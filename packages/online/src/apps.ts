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

/** Why a host did not start it, with a `stopped` or `exited` state: its platform cannot
 *  give an application a display of its own yet (Windows and macOS, until step 8), the
 *  display server it needs is not installed (Xvfb), the reader at the host said no to a
 *  program by its path, what the file names is not on the host, or it failed to start. */
export type NotStarted = 'isolation' | 'display' | 'refused' | 'missing' | 'failed'

const NOT_STARTED: readonly NotStarted[] = ['isolation', 'display', 'refused', 'missing', 'failed']

/** The state frame, as either side sends it. */
export interface StateFrame {
  t: 'state'
  state: AppState
  code?: number | null
  why?: NotStarted
}

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
export type HostFrame = { t: 'host' } | { t: 'signal'; data: string } | StateFrame

/** What the relay tells a viewer: the lock's frames, whether the host is there, the
 *  host's signalling, where the application stands, and refusals. */
export type RelayToViewer =
  | { t: 'held'; by: string; since: number; taken: boolean }
  | { t: 'hold' }
  | { t: 'host'; up: boolean }
  | { t: 'signal'; data: string }
  | StateFrame
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
  // A reason this side does not know is dropped rather than the frame: a newer host may
  // say more than an older tab can.
  const reason = NOT_STARTED.find((one) => one === why)
  return {
    t: 'state',
    state: known,
    ...(code === undefined ? {} : { code }),
    ...(reason ? { why: reason } : {}),
  }
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

// ---------------------------------------------------------------------------
// What a host has installed (step 3)

/** One application a host has installed, as the new application's chooser offers it:
 *  the id the host knows it by (a desktop entry's id on Linux, a Start menu shortcut on
 *  Windows, a bundle on a Mac), its name, and its icon as a small picture, where the
 *  host found one. The host starts it by the id alone and never by words from elsewhere. */
export interface Installed {
  id: string
  name: string
  icon?: string
}

/** The most applications one host lists. */
export const MOST_INSTALLED = 600
/** The largest icon kept, as its data URL: a 48 pixel PNG or a small SVG. */
export const MOST_ICON = 48 * 1024
/** The largest catalogue, in characters of JSON. */
export const MOST_CATALOGUE = 4 * 1024 * 1024

const ICON = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/

/** One listed application that checks, or null. An icon that does not check is left
 *  off rather than the application. */
export function installedOf(value: unknown): Installed | null {
  if (!isRecord(value) || !isText(value.id, 512) || !isText(value.name, 200)) return null
  const { icon } = value
  const kept = typeof icon === 'string' && icon.length <= MOST_ICON && ICON.test(icon)
  return { id: value.id, name: value.name, ...(kept ? { icon } : {}) }
}

/** A host's catalogue that checks: the applications that do, the first of any id, at
 *  most `MOST_INSTALLED`; null for something that is no list. */
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

/** Where a host's catalogue is kept on the account: `PUT` by the host for itself, `GET`
 *  by any of the reader's devices for a host by its id. */
export const CATALOGUE_PATH = '/v2/apps/catalogue'

// ---------------------------------------------------------------------------
// The picture's signalling (step 4)

/** Why a host has no picture to offer: ffmpeg is not installed there, the offer was not
 *  one it could answer, it has no address to be reached on, or the application is not
 *  running. */
export type NoPicture = 'encoder' | 'offer' | 'network' | 'stopped'

const NO_PICTURE: readonly NoPicture[] = ['encoder', 'offer', 'network', 'stopped']

/** A candidate as the viewer's engine gives it, `RTCIceCandidate.toJSON()`. */
export interface CandidateLine {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
}

/** What the holder says to the host, as `data` of a `signal` frame: its offer (a
 *  receive-only video and the data channel), one of its candidates, or that it is done
 *  with the picture. */
export type ToHost = { offer: string } | { candidate: CandidateLine } | { bye: true }

/** A message to the host as the `signal` frame's `data`. */
export function toHostText(said: ToHost): string {
  return JSON.stringify(said)
}

/** What the host says back: its answer, with every candidate of its own in it, or why
 *  there is no picture - null for a reason this side does not know yet. */
export type FromHost = { answer: string } | { cannot: NoPicture | null }

/** The host's message, read off a `signal` frame's `data`; null for one that does not
 *  check, which is dropped as a frame is. */
export function fromHostOf(data: string): FromHost | null {
  const value = parsed(data)
  if (!isRecord(value)) return null
  if (typeof value.answer === 'string') return { answer: value.answer }
  if (typeof value.cannot === 'string')
    return { cannot: NO_PICTURE.find((one) => one === value.cannot) ?? null }
  return null
}

/** One thing the holder does to the application, as its tab sends it over the
 *  picture's data channel, `input` (the host's `apps_host/input.rs` plays it into the
 *  application's display): the pointer at a point of the display in its own pixels, a
 *  button (a `PointerEvent`'s `button`) pressed or let go, the wheel turned by clicks
 *  (down and right positive), and a key pressed or let go, by the character it gave or
 *  its name (`KeyboardEvent.key`) and the key it was (`KeyboardEvent.code`). */
export type InputEvent =
  | { t: 'move'; x: number; y: number }
  | { t: 'button'; button: number; down: boolean }
  | { t: 'wheel'; x: number; y: number }
  | { t: 'key'; key: string; code: string; down: boolean }

/** An input event as the channel's message. */
export function inputText(event: InputEvent): string {
  return JSON.stringify(event)
}
