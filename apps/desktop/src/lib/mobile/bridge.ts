/** The activity's side of the phone app, and the one place the page looks for it.
 *
 *  A webview has no API for a share, a quick settings tile, a home screen widget
 *  or a speech recogniser, so `MainActivity` hangs one object on the page under
 *  `__NIB_SYSTEM__` and every one of those goes through it. Everything that
 *  crosses is a string, a number or a boolean - a `@JavascriptInterface` carries
 *  nothing else - so anything with a shape is JSON on the way over and is read
 *  by the module that asked for it.
 *
 *  Methods are asked for one at a time rather than the object being taken whole.
 *  There is no object at all in a browser, on a desktop or on iOS, an APK built
 *  before a method existed does not have it, and a test stubs only the method it
 *  is about; each caller says what it needs and does nothing where the answer is
 *  nothing. */

/** Every method `MainActivity.Bridge` publishes. One list, so the page and the
 *  activity can be read against each other; `test/android.test.ts` holds the two
 *  sides to it.
 *
 *  The three about a secret are the AI providers' keys, and they are called from
 *  ai/keys.ts rather than from here - that module asks the same object for its own
 *  three by name, the way everything on this bridge is asked for. They are in the
 *  list because the list is what the activity publishes, not what this file uses. */
export interface NibSystem {
  /** The four edges the system bars keep, as JSON; see insets.ts. */
  insets(): string
  /** Which way round the system bars' own icons go. */
  bars(dark: boolean): void
  /** What a tile or a widget row asked for, once, as JSON; see handed.ts. */
  handed(): string
  /** What another app shared, without the bytes, as JSON; see shared.ts. */
  shared(): string
  /** One slice of one shared file, as base64. */
  sharedBytes(at: number, offset: number, length: number): string
  /** The page has written what it was given; the copies may go. */
  sharedDone(): void
  /** The rows the home screen draws, as JSON; see widgets.ts. */
  widgets(json: string): void
  /** Whether this phone has a speech recogniser at all. */
  dictates(): boolean
  /** Turns dictation on or off; answers whether it is listening. */
  listen(on: boolean): boolean
  /** An AI provider's key, out of the file the Keystore guards; see ai/keys.ts. */
  secretRead(name: string): string | null
  secretWrite(name: string, secret: string): void
  secretForget(name: string): void
}

/** One method of the bridge, or nothing where there is no activity behind it. */
export function method<K extends keyof NibSystem>(name: K): NibSystem[K] | undefined {
  const found: unknown = (globalThis as { __NIB_SYSTEM__?: unknown }).__NIB_SYSTEM__
  if (typeof found !== 'object' || found === null) return undefined

  // Checked before it is named: a value crossing into the page is unknown until
  // it has been read.
  const held = (found as Partial<NibSystem>)[name]
  return typeof held === 'function' ? held : undefined
}

/** Whether the page is running inside the activity at all, which is the one
 *  question every mobile feature asks before it offers itself. */
export function onTheActivity(): boolean {
  return !!method('insets')
}

/** What the activity calls back on. Kotlin cannot hold a reference to a function,
 *  so it runs a line in the page instead and the page leaves one on the window
 *  under the name that line names; `undefined` takes it away again.
 *
 *  On the window rather than on `globalThis`, because that is what the activity
 *  writes (`window.__nibInsets?.()`) and the two have to be the same object. */
export function answer(
  name: string,
  fn: ((text: string) => void) | (() => void) | undefined,
): void {
  if (typeof window === 'undefined') return
  Object.assign(window, { [name]: fn })
}
