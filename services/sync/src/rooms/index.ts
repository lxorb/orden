/** The door to a room: who may open a file's socket, what they may do once they
 *  are in, which object it leads to, and what shape the document in it has.
 *
 *  Everything about who is allowed in is decided here rather than in the room,
 *  because this is where the database is. That is the file's space being one the
 *  person whose session the socket carries can reach: their own space, one
 *  somebody shared with them, or one a link let them into as a guest. The room
 *  learns one thing from the answer, which is whether this socket may write; it
 *  never learns who anybody is.
 *
 *  The token rides in the socket's subprotocol rather than in a header or the
 *  address. A browser cannot put a header on a WebSocket, and a token in the
 *  address ends up in logs and referrers; a subprotocol is a header the browser
 *  will set, and the server names it back so the handshake completes. Which is
 *  also why this route sits outside the session guard - the guard reads
 *  `Authorization`, and a socket has none. */

import { Hono } from 'hono'
import { subprotocol, tokenOf } from '@nib/rooms'
import { now, sha256 } from '../crypto'
import type { Env } from '../types'
import { roomKind } from './kind'

/** All three halves of the question in one round trip: whether the session is
 *  live, whether the note belongs to a space the person behind it can reach, and
 *  what they may do there.
 *
 *  One query rather than four, because this runs in front of every socket a note
 *  opens and a reader is waiting on it. Each answer comes back on its own so the
 *  cases can still be told apart: without a live session a client has to sign in
 *  again, while a note nobody shared is a note that does not exist.
 *
 *  There are two kinds of session and `me` is either of them. An account's
 *  membership is joined on the address rather than on the account id, which is
 *  what lets somebody invited before they had an account walk straight in on the
 *  day they prove it; a guest's is joined on the guest, which is what a link
 *  handed out. Neither kind can be both, so the union is at most one row. */
const ALLOWED = `with me as (
  select u.id as user_id, u.email as email, null as guest_id
    from sessions s join users u on u.id = s.user_id
   where s.token_hash = ?1 and s.expires_at > ?2
  union all
  select null as user_id, null as email, s.guest_id as guest_id
    from guest_sessions s
   where s.token_hash = ?1 and s.expires_at > ?2
),
reached as (
  select n.space_id as space_id,
         n.path as path,
         case when sp.user_id = me.user_id then 'owner' else coalesce(m.role, g.role) end as role
    from me
    join notes n on n.id = ?3 and n.deleted = 0
    join spaces sp on sp.id = n.space_id and sp.deleted = 0
    left join space_members m on m.space_id = sp.id and m.email = me.email
    left join guest_members g on g.space_id = sp.id and g.guest_id = me.guest_id
                             and g.joined_at is not null
   where sp.user_id = me.user_id or m.role is not null or g.role is not null
)
select (select coalesce(user_id, guest_id) from me) as who,
       (select space_id from reached) as space_id,
       (select path from reached) as path,
       (select role from reached) as role`

export const rooms = new Hono<{ Bindings: Env }>()

rooms.get('/:noteId', async (context) => {
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'a room is a websocket' }, 426)
  }

  const token = tokenOf(context.req.header('sec-websocket-protocol'))
  const noteId = context.req.param('noteId')

  const allowed = await context.env.DB.prepare(ALLOWED)
    .bind(await sha256(token ?? ''), now(), noteId)
    .first<{
      who: string | null
      space_id: string | null
      path: string | null
      role: string | null
    }>()

  if (!allowed?.who) return context.json({ error: 'sign in first' }, 401)
  // A note in a space nobody shared is indistinguishable from one that is not
  // there, exactly as it is over the rest of the API.
  if (!allowed.space_id) return context.json({ error: 'no such note' }, 404)

  const namespace = context.env.ROOMS
  if (!namespace) return context.json({ error: 'rooms are not running here' }, 503)

  const room = namespace.get(namespace.idFromName(noteId))
  const answer = await room.fetch(
    new Request(context.req.url, {
      headers: {
        upgrade: 'websocket',
        'x-nib-note': noteId,
        'x-nib-space': allowed.space_id,
        // Which shape the room's document is in, which is the file's name and
        // nothing else. Said here because this is where the row was read.
        'x-nib-kind': roomKind(allowed.path ?? ''),
        // The one thing the room is told about the person on the other end.
        // A reader is in the room and sees every keystroke; what the room does
        // with this is refuse the messages that would change the text.
        'x-nib-write': allowed.role === 'read' ? 'no' : 'yes',
      },
    }),
  )

  // The browser refuses the socket unless the server names the subprotocol back.
  const headers = new Headers(answer.headers)
  headers.set('sec-websocket-protocol', subprotocol(token ?? ''))

  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers,
    // What carries the reader's end of the pair the room made.
    webSocket: answer.webSocket,
  })
})
