/** What a caller said, read into the types the verbs work in.
 *
 *  Arguments arrive from two places and neither is trusted. A `nib://` link says
 *  everything as text, because a query string has no other kind. The `nib`
 *  command sends JSON, so a number is a number and a flag is a boolean. Verbs
 *  should not have to know which of those they are looking at, so both are read
 *  here once, at the boundary, the way everything crossing one is; see
 *  docs/conventions.md. */

/** The arguments as they arrived. */
export type Said = Record<string, unknown>

/** Where a request came from, which is not an argument and can never be one: a
 *  link says everything in a query string, so anything a link could set is
 *  something a link could claim.
 *
 *  `link` is a `nib://` address, which anybody can write and send to anybody.
 *  `here` is this machine: the `nib` command, behind a secret only this user can
 *  read; see src-tauri/src/endpoint.rs. Verbs that do not care take neither. */
export type Road = 'link' | 'here'

/** One argument as words, or null when it was not said at all. A number or a
 *  boolean counts as words: a link writes both as text and a caller should not
 *  have to know which side it came from.
 *
 *  An empty string is a value. `content=` is a caller asking for an empty note,
 *  which is a different thing from not asking. */
export function words(said: Said, name: string): string | null {
  const value = said[name]
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return null
}

/** One argument as words that say something, trimmed. Null for one that was not
 *  said or is only spaces, which for a name or a path is the same thing. */
export function said(args: Said, name: string): string | null {
  const value = words(args, name)?.trim()
  return value === undefined || value === '' ? null : value
}

/** One argument as a yes or a no.
 *
 *  `?silent` on its own is a yes, which is how a query string writes one, and so
 *  are `true`, `1` and `yes`. Everything else is a no, including a word nobody
 *  meant as either: a flag that is not understood is a flag that was not set. */
export function yes(args: Said, name: string): boolean {
  const value = args[name]
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value !== 'string') return false

  const folded = value.trim().toLowerCase()
  return folded === '' || folded === 'true' || folded === '1' || folded === 'yes'
}
