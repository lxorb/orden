/** The door to a room: who may open a note's socket, and which object it leads to.
 *
 *  Everything about who is allowed in is decided here rather than in the room,
 *  because this is where the database is. Today that is the note's space
 *  belonging to the account whose session the socket carries - one person's
 *  devices. When a space can be shared, this is the one function that changes:
 *  the room itself never learns who anybody is.
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

/** Both halves of the question in one round trip: whether the session is live, and
 *  whether the note belongs to a space that account holds.
 *
 *  One query rather than three, because this runs in front of every socket a note
 *  opens and a reader is waiting on it. Both answers come back so the two cases can
 *  still be told apart: without a live session a client has to sign in again, while
 *  a note that is not this account's is a note that does not exist. */
const ALLOWED = `select
  (select s.user_id from sessions s where s.token_hash = ?1 and s.expires_at > ?2) as user_id,
  (select n.space_id
     from notes n join spaces sp on sp.id = n.space_id
    where n.id = ?3
      and n.deleted = 0
      and sp.deleted = 0
      and sp.user_id = (
        select s.user_id from sessions s where s.token_hash = ?1 and s.expires_at > ?2
      )) as space_id`

export const rooms = new Hono<{ Bindings: Env }>()

rooms.get('/:noteId', async (context) => {
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'a room is a websocket' }, 426)
  }

  const token = tokenOf(context.req.header('sec-websocket-protocol'))
  const noteId = context.req.param('noteId')

  const allowed = await context.env.DB.prepare(ALLOWED)
    .bind(await sha256(token ?? ''), now(), noteId)
    .first<{ user_id: string | null; space_id: string | null }>()

  if (!allowed?.user_id) return context.json({ error: 'sign in first' }, 401)
  // A note in another account's space is indistinguishable from one that is not
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
