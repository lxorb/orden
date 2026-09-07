/** What the plugin can say about itself, when nothing else works.
 *
 *  A phone has no console to open and no storage inspector, so a build that
 *  comes up wrong on a device is otherwise a blank panel and no reason. This
 *  gathers the few facts that tell one wrong thing from another - what the page
 *  is, what the phone app put on it, and which of the stores kept anything since
 *  last time - as lines short enough to photograph.
 *
 *  It depends on nothing: not on the bridge, not on the glasses, not on being
 *  signed in. Whatever it cannot find, it says it could not find. */

import { readAll, THIS_PAGE } from './keep'

export interface Fact {
  name: string
  value: string
}

/** The names on `window` that could be a phone app's channel.
 *
 *  Written as a filter over names handed in rather than read off `window` here,
 *  so what counts is testable and so the caller decides what it is looking at. */
const LOOKS_LIKE = /flutter|inappwebview|evenapp|evenhub|_listenEven|bridge|native|^webkit$/i

export function bridgeLike(names: readonly string[]): string[] {
  return names.filter((name) => LOOKS_LIKE.test(name)).sort()
}

/** Whatever is at `window.<name>`, said in one word. */
function shapeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array(${value.length})`
  return typeof value
}

/** The one channel that matters, in as much detail as it has.
 *
 *  Everything the SDK sends goes through `flutter_inappwebview.callHandler` and
 *  through nothing else: given a page with only `webkit.messageHandlers` on it,
 *  the SDK answers every call with `invalid` and says the Flutter handler is not
 *  available. So this is the fact the whole plugin turns on. */
export function hostFacts(global: Record<string, unknown>): Fact[] {
  const flutter = global.flutter_inappwebview
  const handler =
    typeof flutter === 'object' && flutter !== null
      ? (flutter as Record<string, unknown>).callHandler
      : undefined

  return [
    { name: 'flutter_inappwebview', value: shapeOf(flutter) },
    { name: '.callHandler', value: shapeOf(handler) },
    { name: '_listenEvenAppMessage', value: shapeOf(global._listenEvenAppMessage) },
    { name: 'EvenAppBridge', value: shapeOf(global.EvenAppBridge) },
    { name: 'webkit', value: shapeOf(global.webkit) },
  ]
}

/** What one launch writes down for the next one to read. */
export interface Launch {
  count: number
  at: string
}

const LAUNCH = 'nib:even:launch'

function launchOf(written: string | null): Launch | null {
  if (!written) return null

  try {
    const parsed: unknown = JSON.parse(written)
    if (typeof parsed !== 'object' || parsed === null) return null

    const { count, at } = parsed as { count?: unknown; at?: unknown }
    if (typeof count !== 'number' || typeof at !== 'string') return null

    return { count, at }
  } catch {
    // Somebody else's value, or half a write. Either way, not a launch.
    return null
  }
}

/** Reads what the last launch left, counts this one, and writes it back to every
 *  store.
 *
 *  This is the whole of the storage question in one line of the view: if the
 *  count is 1 on the fifth launch, nothing survives, and which stores answered
 *  says what did. */
export async function countLaunch(): Promise<{ before: Launch | null; stores: Fact[] }> {
  // The page's own stores only. They answer at once, and they are the ones the
  // question is about: whether this page keeps anything between launches. The
  // phone app's store waits for a channel that may never come, and a diagnosis
  // that waits for the thing it is diagnosing is no use to anybody.
  const held = await readAll(LAUNCH, THIS_PAGE)
  const before = held.map((one) => launchOf(one.value)).find((one) => one !== null) ?? null

  const now: Launch = { count: (before?.count ?? 0) + 1, at: new Date().toISOString() }
  const written = JSON.stringify(now)

  const stores = await Promise.all(
    THIS_PAGE.map(async (keep) => {
      const kept = held.find((one) => one.name === keep.name)
      try {
        await keep.write(LAUNCH, written)
      } catch {
        return { name: keep.name, value: 'cannot write' }
      }

      if (kept?.failed) return { name: keep.name, value: 'cannot read' }
      const was = launchOf(kept?.value ?? null)
      return { name: keep.name, value: was ? `kept ${String(was.count)}` : 'empty' }
    }),
  )

  return { before, stores }
}

/** An origin can be the empty string rather than missing, which is what a page
 *  on a custom scheme reports, and a blank line in the view is a line nobody can
 *  act on. */
function orNone(value: string | undefined): string {
  return value === undefined || value === '' ? '(none)' : value
}

/** Everything about the page itself, which needs no phone app to answer. */
export function pageFacts(global: Record<string, unknown>): Fact[] {
  const where = global.location as Location | undefined
  const agent = (global.navigator as Navigator | undefined)?.userAgent ?? '?'

  return [
    { name: 'origin', value: orNone(where?.origin) },
    { name: 'protocol', value: where?.protocol ?? '?' },
    { name: 'href', value: (where?.href ?? '?').slice(0, 120) },
    { name: 'agent', value: agent.slice(0, 160) },
  ]
}
