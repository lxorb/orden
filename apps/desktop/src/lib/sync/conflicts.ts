/** What to do when the same note was written in two places.
 *
 *  It happens for one reason: two devices had the note open, or one was offline
 *  for a while, and both of them changed it. Nothing can decide which words the
 *  reader meant, so the only question is what the app does about it, and there
 *  are exactly three honest answers.
 *
 *  `both` is what nib has always done, and the default. The other copy is
 *  written beside the note as `Plan (from another device 2026-09-12).md` and the
 *  reader sorts it out with the diff in front of them. Nothing is ever lost, and
 *  the cost is a second file in the list.
 *
 *  `newest` lets the later of the two stand. Which is only safe because of what
 *  else is kept: the words that lose are in the device's own history, and, if
 *  they had ever been pushed, in the account's - so this is "put the newer one in
 *  front of me and keep the other where I can find it", not "throw one away".
 *
 *  `ask` leaves the note exactly as it is here, holds the other copy, and says
 *  so quietly in the sync pane. The note is not pushed while it waits, because
 *  pushing it is what would overwrite the copy nobody has looked at yet.
 *
 *  Not a per-note choice and not a dialog in the middle of a pass: a conflict
 *  arrives while somebody is typing in a different note, and a modal that steals
 *  the caret to ask about a file they last touched on Tuesday is the wrong shape.
 *  See docs/sync.md. */

export const CONFLICT_RULES = ['both', 'newest', 'ask'] as const

export type ConflictRule = (typeof CONFLICT_RULES)[number]

export const DEFAULT_RULE: ConflictRule = 'both'

export function conflictRule(value: unknown): ConflictRule | null {
  return typeof value === 'string' && (CONFLICT_RULES as readonly string[]).includes(value)
    ? (value as ConflictRule)
    : null
}

/** One note the account and this device disagree about, waiting to be settled.
 *
 *  The other copy is held whole rather than fetched again later: it is the
 *  version the pass had in its hand, and by the time somebody answers, the
 *  account may have moved on. */
export interface Clash {
  /** The note, as this device spells its path. */
  path: string
  /** Its id on the account, so an answer can be pushed without another listing. */
  id: string
  /** The version the other copy is, which an answer writes on top of. */
  version: number
  /** What the other device wrote. */
  theirs: string
  /** When this device noticed. */
  at: number
}

/** What somebody answers with. `mine` keeps this device's words and pushes them,
 *  `theirs` takes the other copy, `both` writes the other copy beside the note -
 *  which is what the default rule does without asking. */
export type Answer = 'mine' | 'theirs' | 'both'

/** Where the other side's copy goes when both copies are kept.
 *
 *  The date rather than a number: a second conflict in the same note on the same
 *  day is rare, and a name with a date in it says what it is in a file list
 *  sorted by name. */
export function conflictPath(path: string): string {
  const stamp = new Date().toISOString().slice(0, 10)
  return path.replace(/(\.[^.\\/]+)$/, ` (from another device ${stamp})$1`)
}
