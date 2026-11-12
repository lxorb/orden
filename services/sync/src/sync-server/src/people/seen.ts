import { askInChunks, AT_A_TIME, places } from '../bound'
import type { Env, User } from '../types'
import { PROFILE_COLUMNS, type Presence, type ProfileRow } from './profile'

export const MOST_PEOPLE = 200

const SHARES_WITH = `(
  u.id = ?1
  or exists (
    select 1 from spaces s join space_members m on m.space_id = s.id
     where s.deleted = 0
       and ((s.user_id = u.id and m.email = ?2 and m.joined_at is not null)
         or (s.user_id = ?1 and m.email = u.email)))
  or exists (
    select 1 from space_members a
      join space_members b on b.space_id = a.space_id
      join spaces s on s.id = a.space_id and s.deleted = 0
     where a.email = ?2 and a.joined_at is not null
       and b.email = u.email and b.joined_at is not null
       and (a.item = '' or b.item = '' or a.item = b.item)))`

export async function seenAmong(
  env: Env,
  asker: User,
  ids: readonly string[],
): Promise<(ProfileRow & { state: Presence | null })[]> {
  const wanted = [...new Set(ids)].slice(0, MOST_PEOPLE)
  return askInChunks(
    wanted,
    async (chunk) => {
      const list = chunk.map((_, at) => `?${at + 3}`).join(', ')
      const { results } = await env.DB.prepare(
        `select ${PROFILE_COLUMNS}, p.state from users u
           left join presence p on p.user_id = u.id
          where u.id in (${list}) and ${SHARES_WITH}`,
      )
        .bind(asker.id, asker.email, ...chunk)
        .all<ProfileRow & { state: Presence | null }>()
      return results
    },
    AT_A_TIME,
  )
}

export async function facesIn(
  env: Env,
  asker: string,
  spaceIds: readonly string[],
  most = 3,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!spaceIds.length) return out

  const found = await askInChunks(
    spaceIds,
    async (chunk) => {
      const list = places(chunk.length)
      const { results } = await env.DB.prepare(
        `select s.id as space_id, s.user_id as user_id, 0 as rank, s.created_at as at
           from spaces s where s.id in (${list})
         union all
         select m.space_id, u.id, 1, m.joined_at from space_members m
           join users u on u.email = m.email
          where m.space_id in (${list}) and m.item = '' and m.joined_at is not null
          order by 1, 3, 4`,
      )
        .bind(...chunk, ...chunk)
        .all<{ space_id: string; user_id: string }>()
      return results
    },
    AT_A_TIME / 2,
  )

  for (const row of found) {
    if (row.user_id === asker) continue
    const held = out.get(row.space_id) ?? []
    if (held.length < most && !held.includes(row.user_id)) held.push(row.user_id)
    out.set(row.space_id, held)
  }
  return out
}
