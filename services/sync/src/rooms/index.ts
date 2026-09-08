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
import { requireUser } from '../auth'
import { ownedSpace } from '../spaces/space'
import type { Env, Note } from '../types'

export const rooms = new Hono<{ Bindings: Env }>()

rooms.get('/:noteId', async (context) => {
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'a room is a websocket' }, 426)
  }

  const offered = context.req.header('sec-websocket-protocol')
  const token = tokenOf(offered)
  const user = await requireUser(context.env, token ? `Bearer ${token}` : undefined)
  if (!user) return context.json({ error: 'sign in first' }, 401)

  const noteId = context.req.param('noteId')
  const note = await context.env.DB.prepare('select * from notes where id = ? and deleted = 0')
    .bind(noteId)
    .first<Note>()

  // A note in another account's space is indistinguishable from one that is not
  // there, exactly as it is over the rest of the API.
  const space = note ? await ownedSpace(context.env, user.id, note.space_id) : null
  if (!note || !space) return context.json({ error: 'no such note' }, 404)

  const namespace = context.env.ROOMS
  if (!namespace) return context.json({ error: 'rooms are not running here' }, 503)

  const room = namespace.get(namespace.idFromName(note.id))
  const answer = await room.fetch(
    new Request(context.req.url, {
      headers: {
        upgrade: 'websocket',
        'x-nib-note': note.id,
        'x-nib-space': note.space_id,
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
