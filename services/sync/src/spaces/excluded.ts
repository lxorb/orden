/** What one space leaves out of what it says about itself: the notes and folders
 *  the search does not walk, the picture of the links does not draw, and the
 *  unlinked mentions do not count.
 *
 *  A list of paths relative to the space, so every machine reads the same list. A
 *  folder stands for everything under it, which is the only pattern a file tree
 *  needs and the only one a row's own menu can produce.
 *
 *  The whole list is written at once, the way the bookmarks are: it is short, and
 *  one PUT of the lot is the only shape in which excluding a folder and taking
 *  back two notes inside it is a single request.
 *
 *  See spaces/bookmarks.ts, whose shape this is. */

import { Hono } from 'hono'
import { now } from '../crypto'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

/** How many paths one space may leave out. Far more than anybody excludes by
 *  hand, and the same number the app holds itself to, so a list that fits there
 *  fits here. */
const MOST = 200
/** A path inside a space, which is a few folder names and a file name. */
const LONGEST_PATH = 300
/** What the column may grow to. Every path is bounded on its own; this is the
 *  other end of the same guard, so a list of legal paths still cannot make the
 *  space listing heavy for every device that reads it. */
const MOST_BYTES = 16 * 1024

/** Whether a path names something inside its own space. The same reading the app
 *  does: a path on somebody's disk, or one that climbs out of the space, is not
 *  something any machine could resolve. */
function inside(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= LONGEST_PATH &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').includes('..')
  )
}

/** What is wrong with the list that arrived, as one sentence the app can show, or
 *  null when nothing is.
 *
 *  Only the list itself. A single path that is not one inside the space is dropped
 *  rather than refused: the list is written whole, so refusing the request over one
 *  entry the app and this version disagree about would be losing the lot. */
function wrong(value: unknown): string | null {
  if (!Array.isArray(value)) return 'excluded must be a list'
  if (value.length > MOST) return `a space leaves out at most ${MOST} paths`
  return null
}

/** The paths that name something inside this space, each once and in the order
 *  they arrived. The one place the two directions agree: what a PUT keeps is what
 *  a read gives back. */
function pathsOf(value: readonly unknown[]): string[] {
  const out: string[] = []

  for (const one of value) {
    if (out.length >= MOST) break
    if (inside(one) && !out.includes(one)) out.push(one)
  }

  return out
}

/** The column, as the app reads it back. Anything in it that is not a path inside
 *  the space is left out: the column is written whole by clients, and a newer one
 *  may keep something this version has never heard of. */
export function readExcluded(raw: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  return Array.isArray(parsed) ? pathsOf(parsed) : []
}

export const spaceExcluded = new Hono<{ Bindings: Env; Variables: Variables }>()

/** The list, whole. Reading it needs no route of its own: the space listing
 *  carries it, so one request brings every space's exclusions along with its
 *  name. */
// The list is the space's rather than the reader's: everyone in it searches the
// same notes, so leaving one out is writing in the space.
spaceExcluded.put('/:id/excluded', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await context.req.json<unknown>().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return context.json({ error: 'send an object' }, 400)
  }

  const sent = (body as Record<string, unknown>).excluded
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  // Written from the paths that were checked rather than from what arrived, so
  // nothing else a client sent along ends up in the column.
  const kept = pathsOf(sent as readonly unknown[])
  const written = JSON.stringify(kept)
  if (new TextEncoder().encode(written).length > MOST_BYTES) {
    return context.json({ error: 'that is more paths than a space leaves out' }, 413)
  }

  // The space is touched as well, so a device that watches for spaces that
  // changed learns that this one did.
  await context.env.DB.prepare('update spaces set excluded = ?, updated_at = ? where id = ?')
    .bind(written, now(), space.id)
    .run()

  return context.json({ excluded: kept })
})
