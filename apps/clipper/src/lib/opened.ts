/** What storage held when this page opened.
 *
 *  Both pages read storage once before they draw anything: that read is what
 *  lets the popup open already in the right language and the right scheme
 *  rather than flashing into them. The components start from the same read.
 *
 *  It lives here rather than travelling down as a prop because it is not a
 *  prop: nothing here changes under a component while it is mounted, and a
 *  prop is a thing Svelte watches for exactly that. Signing in is the one
 *  moment the answer becomes different, and it puts the new one back. */

import type { Settings } from './settings'

let held: Settings | null = null

export function opening(settings: Settings): void {
  held = settings
}

/** Called only from a component, and a component is mounted only after the
 *  page has read storage. */
export function opened(): Settings {
  if (!held) throw new Error('the page was drawn before it read what was stored')
  return held
}
