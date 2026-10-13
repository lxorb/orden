/** Whether this is a fresh start, which opens straight on the welcome note.
 *
 *  Emil, 2026-10-13, on the first screen that asked where somebody's notes come from:
 *  "rather welcome note instead". So nothing is asked: a desktop or a phone app with no
 *  space makes one and opens it on the welcome note, the way the browser build has
 *  always opened on its own (web/commands.ts). Bringing notes over from Obsidian or
 *  Notion is Settings > Import, and the welcome note links there.
 *
 *  Obsidian's rule still decides when: there is no flag saying "first run". With no
 *  space there is a fresh start, and the moment a space exists there is none, whichever
 *  way it arrived - so it is asked of the state every time rather than remembered.
 *
 *  Pure, so the table of reasons is tested on its own; what a fresh start does is
 *  first-space.svelte.ts. */

export interface Moment {
  /** The desktop app or the phone app. The browser build seeds its welcome note
   *  itself, so it always has a space. */
  native: boolean
  /** The Even Realities plugin, which never makes anything new. */
  plugin: boolean
  /** Whether the launch has read the spaces folder yet; before that an empty list
   *  says nothing. See `restored` in workspace.svelte.ts. */
  restored: boolean
  spaces: number
  /** Whether the account is still being looked for, which on a phone takes
   *  seconds. Signed out is not the same as not known yet. */
  restoring: boolean
  /** A session brings its own spaces down; a space made for somebody whose notes are
   *  on their way would be one they never asked for. */
  signedIn: boolean
  /** A link somebody followed, being walked through: the space it is about is the
   *  one they came for. */
  invited: boolean
  /** Tabs open, whatever is in them. A file handed over at launch, from Finder or
   *  the command line, is what somebody asked to see, and it opens straight to it. */
  tabs: number
}

export function startsFresh(now: Moment): boolean {
  if (now.plugin || !now.native) return false
  if (!now.restored || now.restoring) return false
  if (now.signedIn || now.invited) return false

  return now.spaces === 0 && now.tabs === 0
}
