/** The folder icons of one space: which folder in its file tree wears which
 *  icon.
 *
 *  A map rather than a list, keyed by the folder's path relative to the space -
 *  which is what lets every machine read the same tree. A note keeps its icon in
 *  its own front matter and carries it wherever the file goes; a folder is only a
 *  name in a path, with no file of its own to keep one in, so the space keeps it
 *  and the path says whose it is.
 *
 *  The whole map is written at once rather than one folder at a time, the way
 *  bookmarks are. It is the client's own statement about its tree, and one PUT of
 *  the lot is the only shape in which a folder being renamed - every icon under it
 *  leaving one key and arriving at another - is a single request. */

import { Hono } from 'hono'
import { now } from '../crypto'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

/** How many folders of one space may wear an icon. Far more than the sixty
 *  bookmarks a space holds, because these are not a list anybody reads: a big
 *  vault has hundreds of folders and no reason not to mark them all, and one
 *  imported from Obsidian's Iconize plugin arrives with every folder it had
 *  already marked. The app holds itself to the same number, so a map that fits
 *  there fits here; see workspace/folder-icons.svelte.ts. */
const MOST = 400
/** A path inside a space, which is a few folder names. */
const LONGEST_PATH = 300
/** What the column may grow to. Every entry is bounded on its own; this is the
 *  other end of the same guard, so a map of legal entries still cannot make the
 *  space listing heavy for every device that reads it. Four times what bookmarks
 *  are allowed, because four hundred folder paths is that much more than sixty
 *  bookmarks - a map the app considers legal has to be one this takes, or an icon
 *  somebody chose would vanish on the way up. */
const MOST_BYTES = 32 * 1024

/** An icon name: what the space's own icon is checked against, plus the hyphen.
 *
 *  The hyphen is the whole difference, and it is not cosmetic. The picker writes
 *  a space's icon as Lucide's library key, `FileText`, while a note writes its own
 *  as Lucide's plain name, `file-text`, which is what the library calls the icon
 *  and what anybody reading the file can look up. A folder is dressed from the
 *  same picker as a note, so the same names arrive here - and without the hyphen
 *  every one of them would be dropped as not an icon. Iconize's `LiFileText`
 *  passes either way. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
/** As long as a value that is not a name may be. A few code points, because an
 *  emoji is often several - a flag, a skin tone, a zero-width join. */
const LONGEST_MARK = 16
/** What says a value is no emoji: letters, digits, whitespace, the separators a
 *  path is made of, or a control character. */
const NOT_A_MARK = /[A-Za-z0-9\s/\\]|\p{Cc}/u
/** And one thing every emoji has: an actual picture in it. Punctuation is not an
 *  icon, and `-` would otherwise read as one for having none of the above. */
const A_PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

/** A set that is not the stroked one, and a name in it: `flat-color-icons:calendar`.
 *  One colon, a name on each side. The app writes the set's own id in front of
 *  anything but Lucide and the emoji, so a column that took only bare names would
 *  drop every coloured icon anybody chose. */
const PREFIXED = /^[a-z][a-z\d-]{0,31}:[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

/** Whether this is an icon a space or a folder can wear.
 *
 *  Three shapes, and the app's own reading of them: a name, `set:name`, or an emoji
 *  written in a name's place - which is what a vault imported from Obsidian's
 *  Iconize plugin brings, and dropping those would be losing an icon somebody had
 *  already chosen. The emoji half is a picture, a length and the absence of
 *  everything else rather than a list of code points: nothing here has to know which
 *  characters make up an emoji, only that a short value with a picture in it and no
 *  letters, digits, spaces or path separators is neither a name nor something a
 *  client could read back as a path.
 *
 *  Read rather than resolved. This service ships no icons and knows no sets: what it
 *  holds the column to is that a value is the shape of an icon, so a newer app can
 *  name a set this one has never heard of and the column carries it. */
export function isIcon(value: string): boolean {
  if (NAME.test(value) || PREFIXED.test(value)) return true
  return value.length <= LONGEST_MARK && A_PICTURE.test(value) && !NOT_A_MARK.test(value)
}

/** Whether this key names a folder in the space rather than somewhere else. A
 *  path climbing out of the space is not a place in it: the app already sends a
 *  path the space speaks, and this is so the column can never hold one that a
 *  client would then resolve against its own disk. */
function inside(path: string): boolean {
  if (!path || path.length > LONGEST_PATH) return false
  return !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..')
}

/** What is wrong with the map that arrived, as one sentence the app can show, or
 *  null when nothing is.
 *
 *  Only the map itself. A single entry that is not a folder wearing an icon is
 *  dropped rather than refused: the map is written whole, so refusing the request
 *  over one entry the app and this version disagree about would be losing every
 *  icon in the tree. */
function wrong(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'icons must be a map'
  if (Object.keys(value).length > MOST) return `icons holds at most ${MOST} folders`

  return null
}

/** The entries that are a folder in this space with an icon on it, and nothing
 *  else. The one place the two directions agree: what a PUT keeps is what a read
 *  gives back. */
function iconsOf(value: object): Record<string, string> {
  const kept = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      inside(entry[0]) && typeof entry[1] === 'string' && isIcon(entry[1]),
  )

  return Object.fromEntries(kept.slice(0, MOST))
}

/** The column, as the app reads it back. Anything in it that is not a folder
 *  wearing an icon is left out: the column is written whole by clients, and a
 *  newer one may keep an icon this version has never heard of. */
export function readIcons(raw: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  return iconsOf(parsed)
}

export const folderIcons = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The map, whole. Reading it needs no route of its own: the space listing
 *  carries it, so one request brings every space's folder icons along with its
 *  name and its own icon. */
// The icons are the space's rather than the reader's: everyone in it sees the
// same tree, so dressing a folder is writing in the space.
folderIcons.put('/:id/icons', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await context.req.json<unknown>().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return context.json({ error: 'send an object' }, 400)
  }

  const sent = (body as Record<string, unknown>).icons
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  // Written from the entries that were checked rather than from what arrived, so
  // nothing else a client sent along ends up in the column.
  const kept = iconsOf(sent as object)
  const written = JSON.stringify(kept)
  if (new TextEncoder().encode(written).length > MOST_BYTES) {
    return context.json({ error: 'that is more folder icons than a space holds' }, 413)
  }

  // The space is touched as well, so a device that watches for spaces that
  // changed learns that this one did.
  await context.env.DB.prepare('update spaces set icons = ?, updated_at = ? where id = ?')
    .bind(written, now(), space.id)
    .run()

  return context.json({ icons: kept })
})
