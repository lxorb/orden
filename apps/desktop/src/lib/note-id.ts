/** The name a unique note gets: a moment, spelled the way the reader asked for.
 *
 *  A note whose name is a timestamp is a note nothing can collide with and
 *  nothing has to be renamed for: links to it keep working because its name never
 *  changes. Obsidian's "unique note" does the same, with the same tokens, so a
 *  vault of them reads alike in both apps. */

/** The tokens a format may use. Each is as many digits as the token is long,
 *  which is what makes `YYYYMMDDHHmm` read as one number. */
const PARTS: Record<string, (at: Date) => number> = {
  YYYY: (at) => at.getFullYear(),
  MM: (at) => at.getMonth() + 1,
  DD: (at) => at.getDate(),
  HH: (at) => at.getHours(),
  mm: (at) => at.getMinutes(),
  ss: (at) => at.getSeconds(),
}

/** Longest first, so `YYYY` is not read as `YY` twice. */
const TOKEN = new RegExp(
  Object.keys(PARTS)
    .sort((one, other) => other.length - one.length)
    .join('|'),
  'g',
)

/** The formats offered in the settings. The first is the default, and the one
 *  Obsidian starts with. */
export const ID_FORMATS = ['YYYYMMDDHHmm', 'YYYYMMDDHHmmss', 'YYYY-MM-DD HHmm', 'YYYYMMDD']

export const DEFAULT_ID_FORMAT = 'YYYYMMDDHHmm'

/** A format filled in for a moment. Anything that is not a token is kept as it
 *  was written, so a format can carry a separator.
 *
 *  A format with no token in it at all would name every note the same, which is
 *  the one thing a unique name must not do, so the default stands in for it. */
export function noteId(format: string, at: Date = new Date()): string {
  const filled = fill(format, at)
  return filled === format ? fill(DEFAULT_ID_FORMAT, at) : filled
}

function fill(format: string, at: Date): string {
  return format.replace(TOKEN, (token) => {
    const part = PARTS[token]
    return part ? String(part(at)).padStart(token.length, '0') : token
  })
}
