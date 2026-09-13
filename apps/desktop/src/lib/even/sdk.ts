/** The Even Hub bridge, as much of it as the plugin uses.
 *
 *  Built against `@evenrealities/even_hub_sdk` 0.0.15. The SDK is a wrapper over
 *  a channel the Even app's WebView opens: importing it puts a bridge on
 *  `window.EvenAppBridge` and a message handler on `window._listenEvenAppMessage`,
 *  and every call goes out through `window.flutter_inappwebview.callHandler`.
 *  Outside that WebView the calls fail, which is why the import is dynamic and
 *  the host is checked for first: a browser gets no bridge and the app runs as it
 *  always does.
 *
 *  Everything the host sends arrives as JSON and is read field by field here, at
 *  the boundary, into the shapes the rest of the plugin trusts. */

import { waited } from '../timing'

/** The SDK's `OsEventTypeList`, the values the plugin acts on. Written out
 *  rather than imported so that this module can be reasoned about, and used,
 *  without loading the SDK at all. */
const CLICK = 0
const SCROLL_TOP = 1
const SCROLL_BOTTOM = 2
const DOUBLE_CLICK = 3
const FOREGROUND_ENTER = 4
const FOREGROUND_EXIT = 5
const ABNORMAL_EXIT = 6
const SYSTEM_EXIT = 7
const LONG_PRESS = 9

/** The SDK's `EventSourceType`. */
const FROM_RIGHT = 1
const FROM_RING = 2
const FROM_LEFT = 3

type Gesture = 'up' | 'down' | 'tap' | 'double' | 'hold'
/** Which surface the gesture came off. The R1 ring is not a separate kind of
 *  input on the G2: it sends the same gestures as a temple and says so here. */
type Source = 'ring' | 'left' | 'right' | 'unknown'
type Life = 'foreground' | 'background' | 'gone'

export type Input =
  | { kind: 'gesture'; gesture: Gesture; from: Source }
  | { kind: 'life'; life: Life }
  /** One frame of sound off the glasses' microphone, as the host processed it.
   *  Sixteen bit little endian PCM at 16 kHz, which is what the audio path on
   *  these glasses is; see voice.ts, which is the only thing that reads it. */
  | { kind: 'audio'; pcm: Uint8Array }

/** A container, by both of its names. The host matches on the pair and fails
 *  silently when they disagree. */
export interface Container {
  id: number
  name: string
}

/** What became of the page the plugin asked for.
 *
 *  Kept as the host's own four words rather than folded into a boolean, because
 *  they are the difference between a page worth asking for again and one that
 *  never will be, and because a corner that can say which is the only evidence
 *  anybody gets off a phone. */
export type Made = 'made' | 'invalid' | 'oversize' | 'outOfMemory' | 'unknown'

export interface Glasses {
  /** Creates the page. Exactly once for the life of the app: a second call is
   *  refused, and refused slowly. */
  start(page: unknown): Promise<Made>
  /** Makes the page again with other geometry. A flat 165 ms, so the plugin does
   *  it once, when the reader turns the line numbers on or off. */
  rebuild(page: unknown): Promise<boolean>
  words(container: Container, content: string): Promise<boolean>
  listen(handler: (input: Input) => void): () => void
  /** Opens or closes the glasses' own microphone. The startup page has to exist
   *  first, per the SDK's own troubleshooting note, or it answers false. */
  microphone(open: boolean): Promise<boolean>
  /** Asks the glasses to put up their own leave-this-app question. */
  leave(): Promise<void>
}

/** What the phone app keeps for the plugin between launches.
 *
 *  Not the glasses and not this page: the Even app's own store, which is the one
 *  place the platform documents as surviving a reboot. A packed plugin is loaded
 *  from files on the phone rather than from an origin, so nothing about the
 *  page's own storage is promised to outlive a launch. See vault.ts. */
export interface Store {
  read(key: string): Promise<string | null>
  /** False when the host would not take it. The SDK answers `false` rather than
   *  throwing, and a write nobody kept is the difference between a session that
   *  survives a launch and one that does not, so it is answered rather than
   *  dropped. */
  write(key: string, value: string): Promise<boolean>
}

/** Only the methods the plugin calls. Structural rather than the SDK's own class
 *  so that whatever is on the page can be checked against it, the way any value
 *  crossing a boundary is checked. */
interface Bridge {
  createStartUpPageContainer(page: unknown): Promise<unknown>
  rebuildPageContainer(page: unknown): Promise<unknown>
  textContainerUpgrade(container: unknown): Promise<unknown>
  audioControl(open: boolean, source?: string): Promise<unknown>
  shutDownPageContainer(exitMode?: number): Promise<unknown>
  onEvenHubEvent(handler: (event: unknown) => void): () => void
}

/** The two storage calls, which a stand-in need not have. Kept apart from
 *  `Bridge` for exactly that reason: the glasses are what the plugin cannot do
 *  without, and a bridge with no store is still a pair of glasses. */
interface Keeper {
  getLocalStorage(key: string): Promise<unknown>
  setLocalStorage(key: string, value: string): Promise<unknown>
}

const METHODS = [
  'createStartUpPageContainer',
  'rebuildPageContainer',
  'textContainerUpgrade',
  'audioControl',
  'shutDownPageContainer',
  'onEvenHubEvent',
] as const

function isBridge(value: unknown): value is Bridge {
  if (typeof value !== 'object' || value === null) return false

  const one = value as Record<string, unknown>
  return METHODS.every((method) => typeof one[method] === 'function')
}

/** Whether the Even app is behind this page.
 *
 *  Not the same question as whether the SDK is ready: the SDK's own readiness is
 *  about its own initialisation and resolves in any browser, and the calls then
 *  fail one at a time. The host's message handler is the thing that is only
 *  there when the glasses are. */
function hosted(): boolean {
  const host = (globalThis as { flutter_inappwebview?: { callHandler?: unknown } })
    .flutter_inappwebview
  return typeof host?.callHandler === 'function'
}

/** How long to wait for the host to put its handler on the page, and how often
 *  to look.
 *
 *  The handler is not there when the plugin's first line runs. The phone app
 *  installs the channel into the WebView while the page is already loading, and
 *  the platform's own guidance is to wait for the bridge before calling
 *  anything, because a call made before it lands does nothing at all and says
 *  nothing about having done nothing. There is no event to wait on, so this
 *  looks.
 *
 *  This is what made a packed build show an empty panel while the simulator drew
 *  the note perfectly: the simulator installs the channel before the page runs,
 *  so a single look was always enough there and never enough on a phone. Ten
 *  seconds is far longer than a WebView takes and is only ever waited out in a
 *  browser, where nothing is waiting on the answer. */
const HOST_WAIT = 10_000
const HOST_LOOK = 50

/** The event the WebView plugin fires when it has finished installing the
 *  channel.
 *
 *  Its own documentation says the channel is injected before the page runs
 *  *except* on an Android WebView without document-start scripts, where a page
 *  has to wait for this. Even's own documentation never mentions it. Listened
 *  for as well as polled rather than instead of, because a page that attaches
 *  its listener after the event was fired would wait for something that has
 *  already happened, and the poll is what catches that. */
const READY = 'flutterInAppWebViewPlatformReady'

/** Resolves the moment the channel appears, or false when it never does. */
async function waitForHost(): Promise<boolean> {
  if (hosted()) return true

  let announced = (): void => undefined
  const said = new Promise<void>((resolve) => {
    announced = () => {
      resolve()
    }
  })

  // A page is not the only place this runs: a test has no window to listen on,
  // and the poll below is the whole of what is needed there.
  const listens = typeof globalThis.addEventListener === 'function'
  if (listens) globalThis.addEventListener(READY, announced)

  try {
    const until = Date.now() + HOST_WAIT
    while (!hosted()) {
      if (Date.now() >= until) return false
      // Whichever comes first: the announcement, or the next look. The look is
      // what makes an announcement that came too early harmless.
      await Promise.race([said, waited(HOST_LOOK)])
    }

    return true
  } finally {
    if (listens) globalThis.removeEventListener(READY, announced)
  }
}

/** A bridge already standing on the page.
 *
 *  This is how the SDK itself arrives - it puts its singleton there on import -
 *  so a page that has one before the SDK is loaded has been given one on
 *  purpose, and it is used as it stands. That is what makes the plugin drivable
 *  in a browser against a stand-in. */
function standing(): Bridge | null {
  const found = (globalThis as { EvenAppBridge?: unknown }).EvenAppBridge
  return isBridge(found) ? found : null
}

/** The wait for the host, once, shared by everything that wants the bridge.
 *
 *  The token store and the glasses are two faces of one channel and both are
 *  wanted the moment the plugin starts; asking separately would wait separately. */
let connecting: Promise<Bridge | null> | null = null

async function connect(): Promise<Bridge | null> {
  // A bridge somebody put on the page was put there on purpose, and is read as
  // it stands every time: there is nothing to wait for and nothing to share.
  // That is what makes the plugin drivable against a stand-in.
  const already = standing()
  if (already) return already

  connecting ??= reach()
  const bridge = await connecting

  // A host that has not turned up is not the same as a page that will never
  // have one, so a miss is not remembered and the next ask looks again.
  if (!bridge) connecting = null
  return bridge
}

async function reach(): Promise<Bridge | null> {
  if (!(await waitForHost())) return null

  // Dynamic so that the SDK is a chunk of its own, reached only from the plugin
  // entry. The plain build never asks for it.
  const sdk = await import('@evenrealities/even_hub_sdk')
  // The SDK's own wait, which is the step the platform asks for by name, and the
  // step this used to skip. It resolves at once once the host is there.
  const bridge = await sdk.waitForEvenAppBridge()

  return isBridge(bridge) ? bridge : null
}

/** The glasses, or null when this page is not in front of a pair.
 *
 *  Null is the whole of what the plain web build sees, and the plugin then does
 *  nothing at all: no containers, no listeners, no cost. */
export async function connectGlasses(): Promise<Glasses | null> {
  const bridge = await connect()
  return bridge ? glassesOf(bridge) : null
}

function keeps(value: unknown): value is Keeper {
  if (typeof value !== 'object' || value === null) return false

  const one = value as Record<string, unknown>
  return typeof one.getLocalStorage === 'function' && typeof one.setLocalStorage === 'function'
}

/** The phone app's own store, or null when there is no phone app behind this
 *  page or the bridge on it has no store. */
export async function connectStore(): Promise<Store | null> {
  const bridge = await connect()
  if (!keeps(bridge)) return null

  return {
    async read(key) {
      // The host answers an absent key with an empty string, which is not the
      // same thing as a value and must not be read as one.
      const found = await bridge.getLocalStorage(key)
      return typeof found === 'string' && found !== '' ? found : null
    },

    async write(key, value) {
      // `true` is the documented answer; a host that hands back the int takes
      // zero for success the way the rest of this bridge does.
      const answer = await bridge.setLocalStorage(key, value)
      return answer === true || answer === 0 || answer === 'success'
    },
  }
}

/** The host's answer to being asked for a page. Zero is success, and the SDK may
 *  hand back the int or the word; `true` is what a stand-in answers. Anything
 *  else is a page that was not made, and says so in the host's own word so that
 *  the corner can repeat it. */
function madeOf(answer: unknown): Made {
  if (answer === 0 || answer === 'success' || answer === true) return 'made'

  const word = typeof answer === 'number' ? String(answer) : answer
  switch (word) {
    case '1':
    case 'invalid':
      return 'invalid'
    case '2':
    case 'oversize':
      return 'oversize'
    case '3':
    case 'outOfMemory':
      return 'outOfMemory'
    default:
      return 'unknown'
  }
}

/** The host's answer to an image send. It may be the enum's string or its int;
 *  anything else is treated as a failure worth retrying rather than as success. */
/** One frame of sound, whichever of the three shapes the host sent it as.
 *
 *  The SDK's own model says `Uint8Array`, but what crosses a JSON channel is a
 *  `number[]` or a base64 string, and different host versions send different ones.
 *  Read at the boundary, once, like everything else here. */
function pcmOf(found: unknown): Uint8Array | null {
  // An empty frame is not sound. The host sends one at the ends of a stream, and
  // reading it as sound is a phrase that begins with nothing.
  if (found instanceof Uint8Array) return found.length ? found : null
  if (Array.isArray(found)) {
    return found.length ? Uint8Array.from(found.map((one) => Number(one) & 0xff)) : null
  }

  if (typeof found === 'string' && found !== '') {
    try {
      const raw = atob(found)
      const out = new Uint8Array(raw.length)
      for (let at = 0; at < raw.length; at++) out[at] = raw.charCodeAt(at)
      return out
    } catch {
      // Not base64 after all. A frame nobody can read is a frame nobody hears,
      // and the next one arrives in twenty milliseconds.
      return null
    }
  }

  return null
}

function sourceOf(from: unknown): Source {
  switch (from) {
    case FROM_RING:
      return 'ring'
    case FROM_LEFT:
      return 'left'
    case FROM_RIGHT:
      return 'right'
    default:
      return 'unknown'
  }
}

/** An envelope's event type.
 *
 *  Protobuf leaves a zero field out, and a single tap is zero, so a tap arrives
 *  with no type on it at all. The default therefore belongs inside the check for
 *  the envelope and nowhere else: read it outside, and every scroll, every
 *  lifecycle event and every audio frame reads as a tap. */
function typeOf(envelope: unknown): number | null {
  if (typeof envelope !== 'object' || envelope === null) return null

  const found = (envelope as { eventType?: unknown }).eventType
  return typeof found === 'number' ? found : CLICK
}

function sourceIn(envelope: unknown): Source {
  if (typeof envelope !== 'object' || envelope === null) return 'unknown'
  return sourceOf((envelope as { eventSource?: unknown }).eventSource)
}

/** How long two of the same lifecycle event count as one.
 *
 *  The firmware sends a pair about a tenth of a second apart for one physical
 *  transition. Gestures are not treated this way on purpose: two swipes in a
 *  row are two pages. */
const SAME_LIFE = 600

/** One event from the host, as something the plugin acts on, or null when it is
 *  nothing to do with the note - an audio frame, a list selection, an IMU
 *  reading.
 *
 *  A swipe reaches the container that captures events, which here is a text
 *  container, so it arrives as a text event. A press is always a system event
 *  whatever is capturing. Some firmware also puts the swipes on the system
 *  event, which is where the ring's own come from, so both are read. */
function inputOf(event: Record<string, unknown>): Input | null {
  // Sound first, because it is the one that arrives fifty times a second and
  // carries no event type of its own to be mistaken for a tap.
  const audio = event.audioEvent
  if (typeof audio === 'object' && audio !== null) {
    const pcm = pcmOf((audio as { audioPcm?: unknown }).audioPcm)
    return pcm ? { kind: 'audio', pcm } : null
  }

  const text = typeOf(event.textEvent)
  if (text === SCROLL_TOP) return { kind: 'gesture', gesture: 'up', from: 'unknown' }
  if (text === SCROLL_BOTTOM) return { kind: 'gesture', gesture: 'down', from: 'unknown' }

  const sys = typeOf(event.sysEvent)
  if (sys === null) return null

  const from = sourceIn(event.sysEvent)
  switch (sys) {
    // Double before single: a double arrives as its own type, and reading the
    // single first would eat it.
    case DOUBLE_CLICK:
      return { kind: 'gesture', gesture: 'double', from }
    case LONG_PRESS:
      return { kind: 'gesture', gesture: 'hold', from }
    case CLICK:
      return { kind: 'gesture', gesture: 'tap', from }
    case SCROLL_TOP:
      return { kind: 'gesture', gesture: 'up', from }
    case SCROLL_BOTTOM:
      return { kind: 'gesture', gesture: 'down', from }
    case FOREGROUND_ENTER:
      return { kind: 'life', life: 'foreground' }
    case FOREGROUND_EXIT:
      return { kind: 'life', life: 'background' }
    case ABNORMAL_EXIT:
    case SYSTEM_EXIT:
      return { kind: 'life', life: 'gone' }
    default:
      return null
  }
}

function glassesOf(bridge: Bridge): Glasses {
  let lastLife: { life: Life; at: number } | null = null

  return {
    async start(page) {
      return madeOf(await bridge.createStartUpPageContainer(page))
    },

    async rebuild(page) {
      // Documented as answering a boolean. A host that hands back the int takes
      // zero for success, the way the rest of this bridge does.
      const answer = await bridge.rebuildPageContainer(page)
      return answer === true || answer === 0 || answer === 'success'
    },

    async words(container, content) {
      // A plain object rather than the SDK's class: the host mapper reads it
      // through the same static `toJson`, and this way the plugin can be driven
      // against a stand-in that has no classes to build.
      const answer = await bridge.textContainerUpgrade({
        containerID: container.id,
        containerName: container.name,
        content,
      })
      return answer === true
    },

    async microphone(open) {
      // The glasses' own microphone rather than the phone's: the reader is looking
      // through the glasses and speaking into them, and the phone may be in a
      // pocket. The string rather than the SDK's enum, which is what it is.
      const answer = await bridge.audioControl(open, 'glasses')
      return answer === true || answer === 0 || answer === 'success'
    },

    listen(handler) {
      return bridge.onEvenHubEvent((event) => {
        if (typeof event !== 'object' || event === null) return

        const one = event as Record<string, unknown>
        const input = inputOf(one)
        if (!input) return

        // One physical transition can arrive twice, a tenth of a second apart.
        // Only lifecycle events are folded together: two swipes in a row are
        // two pages, and always were.
        if (input.kind === 'life') {
          const now = Date.now()
          if (lastLife?.life === input.life && now - lastLife.at < SAME_LIFE) return

          lastLife = { life: input.life, at: now }
        }

        handler(input)
      })
    },

    async leave() {
      // Mode 1 puts the system's own question up rather than closing at once,
      // which is what a review of the app checks for on its root page.
      await bridge.shutDownPageContainer(1)
    },
  }
}
