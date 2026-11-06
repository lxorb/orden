import type { Role } from '@orden/chats'
import type { Env, Whoever } from '../types'

export interface Reached {
  chat: string
  space: string
  role: Role
  id: string
  guest: boolean
}

const reached = (me: string, chat: string) => `with ${me},
reached as (
  select ch.id as chat, sp.id as space,
         coalesce(me.user_id, me.guest_id) as id, (me.guest_id is not null) as guest,
         case when me.user_id is not null and sp.user_id = me.user_id then 'owner'
              when 'write' in (coalesce(ms.role, ''), coalesce(mi.role, ''),
                               coalesce(gs.role, ''), coalesce(gi.role, '')) then 'write'
              else 'read' end as role
    from me
    join chats ch on ch.id = ${chat} and ch.ended_at is null
    join spaces sp on sp.id = ch.space_id and sp.deleted = 0
    left join notes f on f.id = ch.file_id and f.space_id = ch.space_id and f.deleted = 0
    left join space_members ms on ms.space_id = sp.id and ms.email = me.email and ms.item = ''
    left join space_members mi on mi.space_id = sp.id and mi.email = me.email and mi.item = f.id
    left join guest_members gs on gs.space_id = sp.id and gs.guest_id = me.guest_id
                              and gs.item = '' and gs.joined_at is not null
    left join guest_members gi on gi.space_id = sp.id and gi.guest_id = me.guest_id
                              and gi.item = f.id and gi.joined_at is not null
   where (me.user_id is not null and sp.user_id = me.user_id) or ms.role is not null
      or mi.role is not null or gs.role is not null or gi.role is not null
)`

const TOKEN_ME = `me as (
  select u.id as user_id, u.email as email, null as guest_id
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = ?1 and s.expires_at > ?2
  union all
  select null as user_id, null as email, s.guest_id as guest_id
    from guest_sessions s where s.token_hash = ?1 and s.expires_at > ?2
)`

const ASKING_ME = 'me as (select ?1 as user_id, ?2 as email, ?3 as guest_id)'

const PERSON_ME = `me as (
  select u.id as user_id, u.email as email, null as guest_id from users u
   where ?2 = 0 and u.id = ?1
  union all
  select null, null, g.id from guests g where ?2 = 1 and g.id = ?1
)`

const PICKED = 'select chat, space, role, id, guest from reached'

interface Row {
  chat: string | null
  space: string | null
  role: string | null
  id: string | null
  guest: number | null
}

function reachedOf(row: Row | null): Reached | null {
  if (!row?.chat || !row.space || !row.id) return null
  const role = row.role === 'owner' || row.role === 'write' ? row.role : 'read'
  return { chat: row.chat, space: row.space, role, id: row.id, guest: row.guest === 1 }
}

export function askingOf(who: Whoever): [string | null, string | null, string | null] {
  return who.kind === 'user' ? [who.user.id, who.user.email, null] : [null, null, who.guest.id]
}

export async function reachChat(env: Env, who: Whoever, chat: string): Promise<Reached | null> {
  const row = await env.DB.prepare(`${reached(ASKING_ME, '?4')} ${PICKED}`)
    .bind(...askingOf(who), chat)
    .first<Row>()
  return reachedOf(row)
}

export async function reachAs(
  env: Env,
  person: { id: string; guest: boolean },
  chat: string,
): Promise<Reached | null> {
  const row = await env.DB.prepare(`${reached(PERSON_ME, '?3')} ${PICKED}`)
    .bind(person.id, person.guest ? 1 : 0, chat)
    .first<Row>()
  return reachedOf(row)
}

export async function reachByToken(
  env: Env,
  tokenHash: string,
  at: number,
  chat: string,
): Promise<{ live: boolean; reached: Reached | null }> {
  const row = await env.DB.prepare(`${reached(TOKEN_ME, '?3')} ${PICKED}`)
    .bind(tokenHash, at, chat)
    .first<Row>()
  if (row) return { live: true, reached: reachedOf(row) }

  const live = await env.DB.prepare(
    `select 1 as yes from sessions where token_hash = ?1 and expires_at > ?2
     union all select 1 from guest_sessions where token_hash = ?1 and expires_at > ?2`,
  )
    .bind(tokenHash, at)
    .first<{ yes: number }>()
  return { live: live !== null, reached: null }
}

export function hubIdOf(who: string): string {
  return who.slice(who.indexOf(':') + 1)
}

const PEOPLE = `with c as (
  select sp.id as space_id, sp.user_id as owner, f.id as file_id
    from chats ch join spaces sp on sp.id = ch.space_id and sp.deleted = 0
    left join notes f on f.id = ch.file_id and f.space_id = ch.space_id and f.deleted = 0
   where ch.id = ?1 and ch.ended_at is null
),
people as (
  select owner as id, 0 as guest, 3 as rank from c
  union all
  select u.id, 0, case m.role when 'write' then 2 else 1 end
    from c join space_members m on m.space_id = c.space_id and (m.item = '' or m.item = c.file_id)
    join users u on u.email = m.email
  union all
  select g.guest_id, 1, case g.role when 'write' then 2 else 1 end
    from c join guest_members g on g.space_id = c.space_id
                               and (g.item = '' or g.item = c.file_id) and g.joined_at is not null
)
select id, guest, max(rank) as rank from people group by id, guest`

export async function reaching(env: Env, chat: string): Promise<{ id: string; guest: boolean }[]> {
  const { results } = await env.DB.prepare(PEOPLE).bind(chat).all<{ id: string; guest: number }>()
  return results.map((one) => ({ id: one.id, guest: one.guest === 1 }))
}
