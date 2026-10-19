/** Whether this launch starts fresh: a desktop or phone app with no space, which then
 *  opens on the welcome note in a space made for it, asking nothing (first-space.svelte.ts).
 *  Obsidian's rule decides when - no flag says "first run": no space is a fresh start,
 *  and a space, however it arrived, is not. Pure, so the reasons are tested on their own. */

export interface Moment {
  /** The browser build seeds its own welcome note, so only the apps start fresh. */
  native: boolean
  plugin: boolean
  /** Before the spaces folder is read, an empty list says nothing. */
  restored: boolean
  spaces: number
  /** The account still being looked for; on a phone that takes seconds. */
  restoring: boolean
  /** A session brings its own spaces down. */
  signedIn: boolean
  /** A link being walked through is about the space it came for. */
  invited: boolean
  /** A file handed over at launch is what somebody asked to see. */
  tabs: number
}

export function startsFresh(now: Moment): boolean {
  if (now.plugin || !now.native) return false
  if (!now.restored || now.restoring) return false
  if (now.signedIn || now.invited) return false

  return now.spaces === 0 && now.tabs === 0
}
