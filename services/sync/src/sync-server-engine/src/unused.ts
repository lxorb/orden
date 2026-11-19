import { chunks, type Env, now, RESTAMP } from '../../sync-server/src/api'
import { letGo, reading } from './used'

export const RIGHT_AFTER = 25
export const NIGHTLY = 200
export const GRACE = 30 * 24 * 60 * 60 * 1000
export const DEVICES_COUNT_FOR = 90 * 24 * 60 * 60 * 1000
const HASHES_AT_ONCE = 10_000
export function noteUnused(env: Env, spaceId: string, hashes: Iterable<string>, at: number): D1PreparedStatement[] {
  return chunks([...new Set(hashes)], HASHES_AT_ONCE).map((piece) =>
    env.DB.prepare(
      `insert into unused_blobs (user_id, hash, since)
         select sp.user_id, value, ?3 from spaces sp, json_each(?2)
          where sp.id = ?1 and value != '' ${RESTAMP}`,
    ).bind(spaceId, JSON.stringify(piece), at),
  )
}
export function noteUnusedBy(env: Env, userId: string, hashes: readonly string[], at: number): D1PreparedStatement {
  return env.DB.prepare(
    `insert into unused_blobs (user_id, hash, since)
       select user_id, hash, ?3 from blobs
        where user_id = ?1 and hash in (select value from json_each(?2)) ${RESTAMP}`,
  ).bind(userId, JSON.stringify(hashes), at)
}
export function noteChatFiles(env: Env, where: string, at: number, ...bound: string[]): D1PreparedStatement {
  return env.DB.prepare(
    `insert into unused_blobs (user_id, hash, since)
       select b.user_id, b.hash, ?1
         from chat_files f
         join chats c on c.id = f.chat_id
         join spaces sp on sp.id = c.space_id
         join blobs b on b.hash = f.hash
        where ${where}
          and (b.user_id = sp.user_id
               or exists (select 1 from space_members m join users u on u.email = m.email
                           where m.space_id = sp.id and u.id = b.user_id))
          and not exists (select 1 from blobs o where o.hash = b.hash and o.user_id <> b.user_id)
       ${RESTAMP}`,
  ).bind(at, ...bound)
}
export async function sweepUnused(
  env: Env,
  most = NIGHTLY,
  at = now(),
  asked?: { user: string; since: number },
): Promise<number> {
  const { results } = await env.DB.prepare(
    `select user_id, hash from unused_blobs u
      where (since <= ?2
             and not exists (select 1 from devices d
                              where d.user_id = u.user_id and d.revoked_at is null
                                and coalesce(d.last_seen_at, d.created_at) < u.since
                                and coalesce(d.last_seen_at, d.created_at) >= ?5))
         or (user_id = ?3 and since >= ?4)
      order by user_id = ?3 and since >= ?4 desc, since, hash limit ?1`,
  )
    .bind(most, at - GRACE, asked?.user ?? '', asked?.since ?? 0, at - DEVICES_COUNT_FOR)
    .all<{ user_id: string; hash: string }>()
  const done = reading()
  let decided = 0
  for (const one of results) {
    const settled = await letGo(env, one.user_id, one.hash, true, done)
    const versioned = done.versioned.has(`${one.user_id} ${one.hash}`)
    const gone = settled && !versioned
    await env.DB.prepare(
      gone
        ? 'delete from unused_blobs where user_id = ?1 and hash = ?2'
        : 'update unused_blobs set since = ?3 where user_id = ?1 and hash = ?2',
    )
      .bind(one.user_id, one.hash, ...(gone ? [] : [versioned ? at : at - GRACE]))
      .run()
    if (gone) decided += 1
  }
  return decided
}
