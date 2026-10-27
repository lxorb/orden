/** What a socket already in a room may still do to its file, asked again once a
 *  minute beside its sign-in (`askSignIns` in room.ts).
 *
 *  The checks a socket was let in on are made at the handshake, and the route that
 *  takes somebody's access away tells the rooms they have open (`roomsRevoked`). That
 *  telling can miss: a room a moment away from answering, a row gone. This is what
 *  catches what it missed, a minute late rather than never.
 *
 *  Asked by the sign-in the socket came with, the way the door asks (`ALLOWED` in
 *  index.ts), but without leaving out a file in Recently deleted or the space it is
 *  in: what this says is whether the person is still in the space at all, and a file
 *  going is not their access ending. A sign-in that has ended answers nothing here;
 *  the sign-in check closes those. */

import type { Env } from '../types'

/** The person a sign-in is, if it lives: an account or a guest. */
export const SIGNED_IN_AS = `me as (
  select u.id as user_id, u.email as email, null as guest_id, s.id as session_id
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = ?1 and s.expires_at > ?2
  union all
  select null as user_id, null as email, s.guest_id as guest_id, null as session_id
    from guest_sessions s
   where s.token_hash = ?1 and s.expires_at > ?2
)`

const ACCESS = `with ${SIGNED_IN_AS}
select case when sp.user_id = me.user_id then 'write'
            when 'write' in (coalesce(ms.role, ''), coalesce(mi.role, ''),
                             coalesce(gs.role, ''), coalesce(gi.role, '')) then 'write'
            when ms.role is not null or mi.role is not null
              or gs.role is not null or gi.role is not null then 'read'
            else 'none' end as role
  from me
  join notes n on n.id = ?3
  join spaces sp on sp.id = n.space_id
  left join space_members ms on ms.space_id = sp.id and ms.email = me.email and ms.item = ''
  left join space_members mi on mi.space_id = sp.id and mi.email = me.email and mi.item = n.id
  left join guest_members gs on gs.space_id = sp.id and gs.guest_id = me.guest_id
                            and gs.item = '' and gs.joined_at is not null
  left join guest_members gi on gi.space_id = sp.id and gi.guest_id = me.guest_id
                            and gi.item = n.id and gi.joined_at is not null
 limit 1`

export type Access = 'write' | 'read' | 'none'

/** What each of these sign-ins, by hash, may do to the note now. One that has ended,
 *  or a note no longer there at all, is left out: nothing is known about it here. */
export async function accessOf(
  env: Env,
  noteId: string,
  logins: readonly string[],
): Promise<Map<string, Access>> {
  const at = Date.now()
  const found = new Map<string, Access>()
  await Promise.all(
    [...new Set(logins)].map(async (login) => {
      const row = await env.DB.prepare(ACCESS).bind(login, at, noteId).first<{ role: string }>()
      if (row?.role === 'write' || row?.role === 'read' || row?.role === 'none') {
        found.set(login, row.role)
      }
    }),
  )
  return found
}
