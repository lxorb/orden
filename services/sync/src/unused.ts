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
import { chunks } from './bound'
import { now } from './crypto'
import { reading } from './used'
import type { Env } from './types'

/** How many one sweep asks about. Each is a give-back, which is a handful of
 *  questions and perhaps a few notes read, so the request that purged asks about a
 *  few and the nightly job about more. */
export const RIGHT_AFTER = 25
export const NIGHTLY = 200

/** How many hashes one statement's list names. D1 takes two million bytes in a bound
 *  value and a hash is 67 of them in a list, and a note of four megabytes can name more
 *  than that holds; a list too long would be a purge that fails every time. */
const HASHES_AT_ONCE = 10_000

/** The statements that write down these hashes, for the owner of this space. */
export function noteUnused(
  env: Env,
  spaceId: string,
  hashes: Iterable<string>,
  at: number,
): D1PreparedStatement[] {
  return chunks([...new Set(hashes)], HASHES_AT_ONCE).map((piece) =>
    env.DB.prepare(
      `insert or ignore into unused_blobs (user_id, hash, since)
         select sp.user_id, value, ?3 from spaces sp, json_each(?2)
          where sp.id = ?1 and value != ''`,
    ).bind(spaceId, JSON.stringify(piece), at),
  )
}

/** The statement that writes down the files somebody's deleted chat message stopped
 *  naming, for them: a chat knows who posted a message, and nobody else's row is theirs to
 *  ask about (see above). */
export function noteUnusedBy(
  env: Env,
  userId: string,
  hashes: readonly string[],
  at: number,
): D1PreparedStatement {
  return env.DB.prepare(
    `insert or ignore into unused_blobs (user_id, hash, since)
       select user_id, hash, ?3 from blobs
        where user_id = ?1 and hash in (select value from json_each(?2))`,
  ).bind(userId, JSON.stringify(hashes), at)
}

/** The statement that writes down the files a chat that has gone named (`where`, on `f`,
 *  `?1` the moment and the rest its own).
 *
 *  Nothing left says who posted them: `chat_files` has no such column, and the row of
 *  somebody who did not may be for a note not written yet, as above. So only where
 *  somebody in the chat's space alone holds the bytes, since a post needs a row: theirs is
 *  the one that posted it, or the one it was handed to. Where two hold them neither is
 *  asked about, and the poster's goes on counting. */
export function noteChatFiles(
  env: Env,
  where: string,
  at: number,
  ...bound: string[]
): D1PreparedStatement {
  return env.DB.prepare(
    `insert or ignore into unused_blobs (user_id, hash, since)
       select b.user_id, b.hash, ?1
         from chat_files f
         join chats c on c.id = f.chat_id
         join spaces sp on sp.id = c.space_id
         join blobs b on b.hash = f.hash
        where ${where}
          and (b.user_id = sp.user_id
               or exists (select 1 from space_members m join users u on u.email = m.email
                           where m.space_id = sp.id and u.id = b.user_id))
          and not exists (select 1 from blobs o where o.hash = b.hash and o.user_id <> b.user_id)`,
  ).bind(at, ...bound)
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
