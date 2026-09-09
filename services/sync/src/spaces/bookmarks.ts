/** The bookmarks of one space: what an account keeps above its file list.
 *
 *  A bookmark is a note, a folder, a heading in a note, or a search, and it
 *  says where it points relative to the space rather than as a path on anyone's
 *  disk - which is what lets every machine read the same list.
 *
 *  The whole list is written at once rather than one bookmark at a time. It is
 *  short, its order is part of it, and one PUT of the lot is the only shape in
 *  which reordering is a single request. */

import { Hono } from 'hono'
import { now } from '../crypto'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

/** More than anyone keeps above a file list, and the same number the app holds
 *  itself to. */
const MOST = 60
/** A path inside a space, which is a few folder names and a file name. */
const LONGEST_PATH = 300
/** A heading, or the words of a search. */
const LONGEST_TEXT = 200
/** What the column may grow to. Every bookmark is bounded on its own; this is
 *  the other end of the same guard, so a list of legal entries still cannot
 *  make the space listing heavy for every device that reads it. */
const MOST_BYTES = 8 * 1024

const KINDS = ['note', 'folder', 'heading', 'search', 'block', 'group'] as const
type Kind = (typeof KINDS)[number]

/** The longest a group's own name may be. A name, not a path: it is what the
 *  rows in the group point back at. */
const LONGEST_PARENT = 100

export interface Bookmark {
  kind: Kind
  path: string
  text: string
  /** The group it sits in, by that group's name, or absent at the top of the
   *  list. Written down like the rest of it: the app draws the list as a tree
   *  from these, so a parent that did not travel would be a group that lost
   *  everything in it on the next machine. */
  parent?: string
}

/** What is wrong with the list that arrived, as one sentence the app can show,
 *  or null when nothing is. */
function wrong(value: unknown): string | null {
  if (!Array.isArray(value)) return 'bookmarks must be a list'
  if (value.length > MOST) return `bookmarks holds at most ${MOST} entries`

  for (const one of value) {
    if (!one || typeof one !== 'object' || Array.isArray(one)) return 'a bookmark must be an object'

    const { kind, path, text } = one as Record<string, unknown>
    if (!KINDS.some((known) => known === kind)) return 'a bookmark must say what kind it is'
    if (typeof path !== 'string' || path.length > LONGEST_PATH) {
      return `a bookmark's path must be text of at most ${LONGEST_PATH} characters`
    }
    if (typeof text !== 'string' || text.length > LONGEST_TEXT) {
      return `a bookmark's text must be text of at most ${LONGEST_TEXT} characters`
    }

    const { parent } = one as Record<string, unknown>
    if (parent !== undefined && (typeof parent !== 'string' || parent.length > LONGEST_PARENT)) {
      return `a bookmark's group must be text of at most ${LONGEST_PARENT} characters`
    }
    // A path climbing out of the space is not a place in it. The app already
    // sends a path the space speaks; this is so the column can never hold one
    // that a client would then resolve against its own disk.
    if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
      return 'a bookmark points inside its own space'
    }
  }

  return null
}

/** The column, as the app reads it back. Anything in it that is not a bookmark
 *  is left out: the column is written whole by clients, and a newer one may
 *  keep a kind this version has never heard of. */
export function readBookmarks(raw: string): Bookmark[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []
  return parsed.filter((one): one is Bookmark => wrong([one]) === null).slice(0, MOST)
}

export const bookmarks = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The list, whole, in the order it should appear. Reading it needs no route of
 *  its own: the space listing carries it, so one request brings every space's
 *  bookmarks along with its name and its icon. */
// The bookmarks are the space's rather than the reader's: everyone in it sees
// the same list, so arranging them is writing in the space.
bookmarks.put('/:id/bookmarks', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await context.req.json<unknown>().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return context.json({ error: 'send an object' }, 400)
  }

  const sent = (body as Record<string, unknown>).bookmarks
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  // Written from the fields that were checked rather than from what arrived, so
  // nothing else a client sent along ends up in the column.
  const kept = (sent as Bookmark[]).map(({ kind, path, text, parent }) => ({
    kind,
    path,
    text,
    ...(parent ? { parent } : {}),
  }))
  const written = JSON.stringify(kept)
  if (new TextEncoder().encode(written).length > MOST_BYTES) {
    return context.json({ error: 'that is more bookmarks than a space holds' }, 413)
  }

  // The space is touched as well, so a device that watches for spaces that
  // changed learns that this one did.
  await context.env.DB.prepare('update spaces set bookmarks = ?, updated_at = ? where id = ?')
    .bind(written, now(), space.id)
    .run()

  return context.json({ bookmarks: kept })
})
