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
  { kind: 'gesture'; gesture: Gesture; from: Source } | { kind: 'life'; life: Life }

/** What became of an image. `again` is worth retrying; `dead` is the documented
 *  wedge where the image channel stops taking anything until the app restarts,
 *  and is the cue to fall back to words. */
export type Sent = 'ok' | 'again' | 'dead'

/** A container, by both of its names. The host matches on the pair and fails
 *  silently when they disagree. */
export interface Container {
  id: number
  name: string
}

export interface Glasses {
  /** Creates the page. Exactly once for the life of the app: a second call is
   *  refused, and refused slowly. */
  start(page: unknown): Promise<boolean>
  image(container: Container, bytes: Uint8Array): Promise<Sent>
  words(container: Container, content: string): Promise<boolean>
  listen(handler: (input: Input) => void): () => void
  /** Asks the glasses to put up their own leave-this-app question. */
  leave(): Promise<void>
}

/** Only the methods the plugin calls. Structural rather than the SDK's own class
 *  so that whatever is on the page can be checked against it, the way any value
 *  crossing a boundary is checked. */
interface Bridge {
  createStartUpPageContainer(page: unknown): Promise<unknown>
  updateImageRawData(data: unknown): Promise<unknown>
  textContainerUpgrade(container: unknown): Promise<unknown>
  shutDownPageContainer(exitMode?: number): Promise<unknown>
  onEvenHubEvent(handler: (event: unknown) => void): () => void
}

const METHODS = [
  'createStartUpPageContainer',
  'updateImageRawData',
  'textContainerUpgrade',
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

/** The glasses, or null when this page is not in front of a pair.
 *
 *  Null is the whole of what the plain web build sees, and the plugin then does
 *  nothing at all: no containers, no listeners, no cost. */
export async function connectGlasses(): Promise<Glasses | null> {
  const already = standing()
  if (already) return glassesOf(already)

  if (!hosted()) return null

  // Dynamic so that the SDK is a chunk of its own, reached only from the plugin
  // entry. The plain build never asks for it.
  const sdk = await import('@evenrealities/even_hub_sdk')
  const bridge = await sdk.waitForEvenAppBridge()

  return isBridge(bridge) ? glassesOf(bridge) : null
}

/** The host's answer to an image send. It may be the enum's string or its int;
 *  anything else is treated as a failure worth retrying rather than as success. */
function sentOf(answer: unknown): Sent {
  const word =
    typeof answer === 'string' ? answer : typeof answer === 'number' ? String(answer) : ''
  if (word === 'success' || word === '0') return 'ok'
  // The one failure no retry helps with: after the leave-this-app question has
  // been up, the image channel can stop taking anything at all for the life of
  // the app. See docs/even.md.
  if (word === 'sendFailed' || word === '3') return 'dead'

  return 'again'
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
      const answer = await bridge.createStartUpPageContainer(page)
      // `success` is zero; the SDK may hand back the int or the enum.
      return answer === 0 || answer === 'success' || answer === true
    },

    async image(container, bytes) {
      // A plain object rather than the SDK's class: the host mapper reads it
      // through the same static `toJson`, and this way the plugin can be driven
      // against a stand-in that has no classes to build.
      return sentOf(
        await bridge.updateImageRawData({
          containerID: container.id,
          containerName: container.name,
          // `number[]` is what the host takes best, per the SDK's own note.
          imageData: Array.from(bytes),
        }),
      )
    },

    async words(container, content) {
      const answer = await bridge.textContainerUpgrade({
        containerID: container.id,
        containerName: container.name,
        content,
      })
      return answer === true
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
