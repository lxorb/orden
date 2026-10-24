/** Letting go of the bytes a purge left nobody using; see migrations/0062.
 *
 *  A purge writes down each hash the purged notes or space used and the space owner
 *  whose row to ask about, and this asks: the row goes the way a give-back takes it
 *  (`letGo` in blobs.ts, counting the owner's own uses too), unless something else of
 *  theirs still shows the bytes. A hash that cannot be decided yet - a note written
 *  before its pictures were written down might show it - stays on the list for the
 *  next sweep, and moves to the back of it so the rest are not held up.
 *
 *  Only the space owner's row: a writer's upload into the owner's space is the
 *  writer's row and the writer's to give back. The purge is the owner's act, and
 *  nothing the writer did says they are done with bytes they may keep for a note of
 *  their own that is not written yet. */

import { letGo } from './blobs'
import { now } from './crypto'
import { reading } from './used'
import type { Env } from './types'

/** How many one sweep asks about. Each is a give-back, which is a handful of
 *  questions and perhaps a few notes read, so the request that purged asks about a
 *  few and the nightly job about more. */
export const RIGHT_AFTER = 25
export const NIGHTLY = 200

/** The statement that writes down these hashes, for the owner of this space. */
export function noteUnused(
  env: Env,
  spaceId: string,
  hashes: Iterable<string>,
  at: number,
): D1PreparedStatement {
  return env.DB.prepare(
    `insert or ignore into unused_blobs (user_id, hash, since)
       select sp.user_id, value, ?3 from spaces sp, json_each(?2)
        where sp.id = ?1 and value != ''`,
  ).bind(spaceId, JSON.stringify([...new Set(hashes)]), at)
}

/** Asks about the oldest on the list, as many as `most`, and answers how many were
 *  decided. The bodies it reads are read once between all of them, within one budget
 *  (`Reading` in used.ts), so a sweep costs the bucket the same however much is on the
 *  list. A request that purged asks about its own account's first, so what it just
 *  purged stops counting against it before anybody else's leftovers are looked at. */
export async function sweepUnused(env: Env, most = NIGHTLY, first = ''): Promise<number> {
  const { results } = await env.DB.prepare(
    'select user_id, hash from unused_blobs order by user_id = ?2 desc, since, hash limit ?1',
  )
    .bind(most, first)
    .all<{ user_id: string; hash: string }>()

  const done = reading()
  let decided = 0
  for (const one of results) {
    const settled = await letGo(env, one.user_id, one.hash, true, done)
    await env.DB.prepare(
      settled
        ? 'delete from unused_blobs where user_id = ?1 and hash = ?2'
        : 'update unused_blobs set since = ?3 where user_id = ?1 and hash = ?2',
    )
      .bind(one.user_id, one.hash, ...(settled ? [] : [now()]))
      .run()
    if (settled) decided += 1
  }
  return decided
}
