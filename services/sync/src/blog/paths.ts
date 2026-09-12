/** Where a page lives, and every path that ever found it.
 *
 *  A note's path is its address by default: `Notes/First Idea.md` is
 *  `/notes/first-idea`. `permalink:` in the front matter says otherwise, and
 *  `aliases:` - the same key the app follows a link by - are the other paths
 *  that should land on the page. Obsidian Publish's keys, so a vault that has
 *  them keeps them.
 *
 *  And then the part nobody thinks about until it has happened: a page moves. A
 *  note is renamed, a permalink is reconsidered, an alias is taken away. The old
 *  path is already in somebody's history, somebody's feed reader and somebody
 *  else's link, so it is remembered and redirects to wherever the page is now. A
 *  404 for a path that used to work is the one answer that helps nobody, and it
 *  is the reason a static site generator makes people keep a redirects file by
 *  hand.
 *
 *  Remembered at the moment it stops being true, which is the moment the note is
 *  written: what the path and the front matter were is in hand there, so nothing
 *  has to be walked and nothing is written when nothing moved. */

import type { Env, Note } from '../types'
import { readFront, type NoteFront } from './front'

/** `Notes/First Idea.md` becomes `notes/first-idea`. */
export function slugFor(path: string): string {
  return path
    .replace(/\.(md|markdown|mdown|mkd)$/i, '')
    .split('/')
    .map((part) =>
      part
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .filter(Boolean)
    .join('/')
}

/** How many paths of one note are remembered. A page that has moved fifty times
 *  has a redirect for each; past that the oldest are let go, because a path
 *  nobody has followed in fifty renames is a path nobody has. */
const MOST_REMEMBERED = 50

/** Every path this note answers on now. The first is where it lives - what a
 *  link to it should use and what everything else redirects to - and the rest
 *  are the aliases. */
export function pathsOf(path: string, front: NoteFront): string[] {
  const where = front.permalink ?? slugFor(path)
  return [...new Set([where, ...(front.aliases ?? [])])].filter(Boolean)
}

/** Where this note lives. */
export function pageOf(path: string, front: NoteFront): string {
  return pathsOf(path, front)[0] ?? slugFor(path)
}

/** Remembers the paths a note has just stopped answering on.
 *
 *  Called from the one place a note is written, with the row as it was and the
 *  words as they are now. Writes nothing at all in the ordinary case, which is a
 *  note whose path and front matter did not change.
 *
 *  Best effort by design: a redirect that could not be written down is not a
 *  reason to fail the save that carried it. */
export async function rememberOldPaths(
  env: Env,
  was: Note,
  path: string,
  front: NoteFront,
): Promise<void> {
  const before = pathsOf(was.path, readFront(was.front))
  const after = new Set(pathsOf(path, front))
  const gone = before.filter((one) => !after.has(one)).slice(0, MOST_REMEMBERED)
  if (!gone.length) return

  const at = Date.now()
  const writes = gone.map((slug) =>
    env.DB.prepare(
      `insert into blog_paths (space_id, slug, note_id, at) values (?, ?, ?, ?)
        on conflict (space_id, slug) do update set note_id = excluded.note_id, at = excluded.at`,
    ).bind(was.space_id, slug, was.id, at),
  )

  // And the oldest of this note's, once it has more than a page needs. One
  // statement in the same batch, so a rename is one round trip however many
  // paths it moved.
  writes.push(
    env.DB.prepare(
      `delete from blog_paths where note_id = ? and slug not in (
         select slug from blog_paths where note_id = ? order by at desc limit ?
       )`,
    ).bind(was.id, was.id, MOST_REMEMBERED),
  )

  await env.DB.batch(writes)
}

/** The note a path used to belong to, for the redirect. */
export async function rememberedNote(
  env: Env,
  spaceId: string,
  slug: string,
): Promise<string | null> {
  const found = await env.DB.prepare(
    'select note_id from blog_paths where space_id = ? and slug = ?',
  )
    .bind(spaceId, slug)
    .first<{ note_id: string }>()

  return found?.note_id ?? null
}
