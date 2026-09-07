/** The plugin's own `localStorage`, one that survives a launch.
 *
 *  A packed plugin is served from `http://127.0.0.1:<port>` with a fresh port
 *  every launch, so the page's real `localStorage` is a different origin's every
 *  time and always comes up empty. Every device-local setting the app has goes
 *  through `localStorage` - the theme, the appearance, the last note, the
 *  sidebar, the shortcuts - in about thirty places across fifteen files. Routing
 *  each of them somewhere else would be thirty chances to miss one.
 *
 *  So the storage is replaced instead of the callers. What the app gets is a
 *  `Storage` backed by a map, seeded from a cookie before the first line of the
 *  app runs, and written back to the cookie and to the phone app's own store
 *  whenever it changes. The app is unaware, which is the point.
 *
 *  Why those two: the cookie is scoped to the host and ignores the port, so it
 *  is the same cookie across launches and it can be read synchronously, before
 *  anything is painted. The phone app's store is the durable one but answers
 *  nothing until its channel arrives, seconds later, which is too late to decide
 *  what colour the app is. So the cookie carries what has to be there at once,
 *  and the host store carries all of it. See docs/even.md. */

import { hostKeep, cookieOf, writeCookie } from './keep'

/** The name both stores keep the settings under. */
const KEY = 'nib:local'

/** What a cookie will take. Four kilobytes is the limit browsers agree on,
 *  including the name and the encoding, so this leaves room to be wrong. */
const COOKIE_ROOM = 3500

/** How long after a change everything is written down. Settings arrive in
 *  bursts - a theme change touches three keys - and each write is a cookie
 *  rewrite and a message to the phone. */
const SETTLE = 400

function parsed(written: string | null): Record<string, string> {
  if (!written) return {}

  try {
    const found: unknown = JSON.parse(written)
    if (typeof found !== 'object' || found === null) return {}

    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(found)) {
      if (typeof value === 'string') out[key] = value
    }

    return out
  } catch {
    // Half a write, or somebody else's value. Either way, no settings.
    return {}
  }
}

/** As much of the settings as a cookie will hold, smallest first.
 *
 *  Smallest first because the ones that decide what the first paint looks like -
 *  the theme, the accent, the appearance - are a few bytes each, and the ones
 *  that would fill a cookie on their own are the ones nobody notices arriving a
 *  moment late. */
function underTheLimit(all: Record<string, string>): Record<string, string> {
  const bySize = Object.entries(all).sort(([, a], [, b]) => a.length - b.length)

  const out: Record<string, string> = {}
  for (const [key, value] of bySize) {
    const next = { ...out, [key]: value }
    if (encodeURIComponent(JSON.stringify(next)).length > COOKIE_ROOM) break

    out[key] = value
  }

  return out
}

class Local implements Storage {
  private readonly held = new Map<string, string>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(seed: Record<string, string>) {
    for (const [key, value] of Object.entries(seed)) this.held.set(key, value)
  }

  get length(): number {
    return this.held.size
  }

  key(at: number): string | null {
    return [...this.held.keys()][at] ?? null
  }

  getItem(key: string): string | null {
    return this.held.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.held.set(key, value)
    this.later()
  }

  removeItem(key: string): void {
    this.held.delete(key)
    this.later()
  }

  clear(): void {
    this.held.clear()
    this.later()
  }

  /** Fills in whatever the phone app kept and the cookie could not hold. Only
   *  keys the app has not already set this launch, so a setting changed while
   *  the channel was still arriving is not undone by the old value landing. */
  fillFrom(older: Record<string, string>): void {
    let grew = false
    for (const [key, value] of Object.entries(older)) {
      if (this.held.has(key)) continue

      this.held.set(key, value)
      grew = true
    }

    if (grew) this.later()
  }

  private later(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), SETTLE)
  }

  private flush(): void {
    const all = Object.fromEntries(this.held)
    writeCookie(KEY, JSON.stringify(underTheLimit(all)))
    // Everything, to the one store with room for it. Nothing waits on it.
    void hostKeep.write(KEY, JSON.stringify(all)).catch(() => undefined)
  }
}

/** Puts the plugin's own storage in front of the page's, before anything reads
 *  it. Answers the store so the caller can fill it in when the phone app
 *  answers, which is seconds later. */
export function installLocal(): Local {
  // The cookie, synchronously: whatever decides the first paint is already here.
  const local = new Local(parsed(cookieOf(KEY)))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: local,
  })

  return local
}

/** The rest of it, once the phone app is reachable. */
export async function fillLocal(local: Local): Promise<void> {
  local.fillFrom(parsed(await hostKeep.read(KEY)))
}
