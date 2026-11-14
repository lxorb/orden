import { chunks } from './bound'
import { now } from './crypto'
import { letGo, reading } from './used'
import type { Env } from './types'

export const RIGHT_AFTER = 25
export const NIGHTLY = 200

const HASHES_AT_ONCE = 10_000

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
