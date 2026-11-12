import { Hono } from 'hono'
import { NO_SUCH_NOTE, ROOM_AWAY, SIGN_IN } from '../refused'
import { subprotocol, tokenOf, tokenProtocolOf } from '@orden/rooms'
import { ROOM_V2_NAMES } from '@orden/sync-core'
import { chunks } from '../bound'
import { now, sha256 } from '../crypto'
import { note } from '../failed'
import type { Env, Note } from '../types'
import { hooks } from '../hooks'
import { SIGNED_IN_AS } from './access'
import { isChatPointer, noteKind } from './kind'
import type { Ingested } from './room'

const ALLOWED = `with ${SIGNED_IN_AS},
reached as (
  select n.space_id as space_id,
         n.path as path,
         n.epoch as epoch,
         n.kind as kind,
         case when sp.user_id = me.user_id then 'owner'
              when 'write' in (coalesce(ms.role, ''), coalesce(mi.role, ''),
                               coalesce(gs.role, ''), coalesce(gi.role, '')) then 'write'
              else 'read' end as role
    from me
    join notes n on n.id = ?3 and n.deleted = 0
    join spaces sp on sp.id = n.space_id and sp.deleted = 0
    left join space_members ms on ms.space_id = sp.id and ms.email = me.email and ms.item = ''
    left join space_members mi on mi.space_id = sp.id and mi.email = me.email and mi.item = n.id
    left join guest_members gs on gs.space_id = sp.id and gs.guest_id = me.guest_id
                              and gs.item = '' and gs.joined_at is not null
    left join guest_members gi on gi.space_id = sp.id and gi.guest_id = me.guest_id
                              and gi.item = n.id and gi.joined_at is not null
   where sp.user_id = me.user_id or ms.role is not null or mi.role is not null
      or gs.role is not null or gi.role is not null
)
select (select coalesce(user_id, guest_id) from me) as who,
       (select guest_id from me) as guest,
       (select d.id from me join devices d on d.session_id = me.session_id
           and d.user_id = me.user_id and d.revoked_at is null limit 1) as bound,
       (select space_id from reached) as space_id,
       (select path from reached) as path,
       (select epoch from reached) as epoch,
       (select kind from reached) as kind,
       (select role from reached) as role`

const TRY_AGAIN_IN = '1'

async function reach(
  namespace: DurableObjectNamespace,
  noteId: string,
  address: string,
  headers: Record<string, string>,
  ray: string | null,
): Promise<Response | null> {
  let last: unknown = null

  for (let asked = 0; asked < 2; asked++) {
    const room = namespace.get(namespace.idFromName(noteId))

    try {
      const answer = await room.fetch(new Request(address, { headers }))
      if (answer.status !== 101 || answer.webSocket) return answer

      last = new Error('the room answered a handshake with no socket on it')
    } catch (error) {
      last = error
    }
  }

  note(`room ${noteId}`, last, ray)
  return null
}

export const rooms = new Hono<{ Bindings: Env }>()

rooms.get('/:noteId', async (context) => {
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'a room is a websocket' }, 426)
  }

  const offered = context.req.header('sec-websocket-protocol')
  const token = tokenOf(offered)
  const noteId = context.req.param('noteId')

  const hash = await sha256(token ?? '')
  const allowed = await context.env.DB.prepare(ALLOWED).bind(hash, now(), noteId).first<{
    who: string | null
    guest: string | null
    bound: string | null
    space_id: string | null
    path: string | null
    epoch: number | null
    kind: string | null
    role: string | null
  }>()

  if (!allowed?.who) return context.json({ error: SIGN_IN }, 401)
  if (!allowed.space_id) return context.json({ error: NO_SUCH_NOTE }, 404)
  if (isChatPointer(allowed.path ?? '')) return context.json({ error: NO_SUCH_NOTE }, 404)

  const namespace = context.env.ROOMS
  if (!namespace) return context.json({ error: 'rooms are not running here' }, 503)

  const answer = await reach(
    namespace,
    noteId,
    context.req.url,
    {
      upgrade: 'websocket',
      'x-orden-note': noteId,
      'x-orden-space': allowed.space_id,
      'x-orden-kind': noteKind({
        path: allowed.path ?? '',
        kind: allowed.kind,
        epoch: allowed.epoch,
      }),
      'x-orden-write': allowed.role === 'write' || allowed.role === 'owner' ? 'yes' : 'no',
      'x-orden-who': allowed.who,
      'x-orden-login': hash,
      'x-orden-epoch': String(allowed.epoch ?? 0),
      'x-orden-v2': offers(offered, ROOM_V2_NAMES) ? 'yes' : 'no',
      'x-orden-device-id': allowed.guest
        ? `guest:${allowed.guest}`
        : (allowed.bound ?? `session:${hash.slice(0, 16)}`),
    },
    context.req.header('cf-ray') ?? null,
  )

  if (!answer) {
    return context.json({ error: ROOM_AWAY }, 503, {
      'retry-after': TRY_AGAIN_IN,
    })
  }

  const headers = new Headers(answer.headers)
  headers.set('sec-websocket-protocol', tokenProtocolOf(offered) ?? subprotocol(token ?? ''))

  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers,
    webSocket: answer.webSocket,
  })
})

export type RoomAsk = 'push' | 'pull' | 'ingest'

export const ROOM_PATIENCE = 15_000

export const ROOM_LATE = Symbol('the room did not answer in time')

async function inTime(
  answer: Promise<Response>,
  patience: number,
): Promise<Response | typeof ROOM_LATE> {
  let late: (value: typeof ROOM_LATE) => void = () => undefined
  const waited = new Promise<typeof ROOM_LATE>((settle) => {
    late = settle
  })
  const timer = setTimeout(() => late(ROOM_LATE), patience)
  try {
    return await Promise.race([answer, waited])
  } finally {
    clearTimeout(timer)
  }
}

export async function askRoom(
  env: Env,
  target: { id: string; space_id: string; path: string; kind?: string; epoch?: number },
  ask: RoomAsk,
  body: Uint8Array,
  patience = ROOM_PATIENCE,
): Promise<Response | typeof ROOM_LATE | null> {
  const namespace = env.ROOMS
  if (!namespace) return null

  for (let asked = 0; asked < 2; asked++) {
    try {
      const room = namespace.get(namespace.idFromName(target.id))
      const answer = room.fetch(
        new Request(`https://rooms.invalid/${target.id}`, {
          method: 'POST',
          headers: {
            'x-orden-doc': ask,
            'x-orden-note': target.id,
            'x-orden-space': target.space_id,
            'x-orden-kind': noteKind(target),
            'x-orden-epoch': String(target.epoch ?? 0),
          },
          body,
        }),
      )
      return await inTime(answer, patience)
    } catch {
      // A reset object: the loop asks the one that replaced it.
    }
  }
  return null
}

export async function ingestInto(
  env: Env,
  target: Note,
  text: string,
  writer: { name: string; device?: string; base?: number },
): Promise<Ingested | null> {
  const body = new TextEncoder().encode(JSON.stringify({ text, ...writer }))
  const answer = await askRoom(env, target, 'ingest', body)
  if (answer === ROOM_LATE || !answer?.ok) return null

  return await answer.json<Ingested>()
}

function protocolsIn(header: string | undefined): string[] {
  return (header ?? '').split(',').map((one) => one.trim())
}

function offers(header: string | undefined, names: readonly string[]): boolean {
  return protocolsIn(header).some((one) => names.includes(one))
}

const MOST_OPEN = 50

const MOST_ROUNDS = 20

export async function roomsRevoked(
  env: Env,
  spaceId: string,
  who: string | null,
  role: 'none' | 'read',
  item = '',
): Promise<void> {
  await hooks().machines.machinesRevoked(env, spaceId, who, role, item)
  if (who) await hooks().chats.chatsRevoked(env, spaceId, who, role, item)

  const namespace = env.ROOMS
  if (!namespace || !who) return

  let after = ''
  for (let round = 0; round < MOST_ROUNDS; round++) {
    const { results } = item
      ? await env.DB.prepare(
          `select note_id from room_sockets
            where space_id = ? and who = ? and note_id = ? and note_id > ?
            order by note_id limit ?`,
        )
          .bind(spaceId, who, item, after, MOST_OPEN)
          .all<{ note_id: string }>()
      : await env.DB.prepare(
          `select note_id from room_sockets
            where space_id = ? and who = ? and note_id > ?
            order by note_id limit ?`,
        )
          .bind(spaceId, who, after, MOST_OPEN)
          .all<{ note_id: string }>()

    if (!results.length) return

    await Promise.all(
      results.map(({ note_id: noteId }) =>
        tell(namespace, noteId, { 'x-orden-revoked': who, 'x-orden-role': role }),
      ),
    )

    if (results.length < MOST_OPEN) return
    after = results[results.length - 1]?.note_id ?? ''
  }
}

const MOST_IN_A_SPACE = 400

export async function spaceEnded(env: Env, spaceId: string): Promise<void> {
  const { results } = await env.DB.prepare(
    `with terms as (
       select 1 from term_sessions t join notes n on n.id = t.term and t.term <> t.session
        where n.space_id = ?1 and t.ended_at is null limit 1
     )
     select who from room_sockets where space_id = ?1
     union select who from chat_sockets where space_id = ?1
     union select u.id from space_members m join users u on u.email = m.email
            where m.space_id = ?1 and exists (select 1 from terms)
     union select g.guest_id from guest_members g
            where g.space_id = ?1 and g.joined_at is not null and exists (select 1 from terms)
     limit ?2`,
  )
    .bind(spaceId, MOST_IN_A_SPACE)
    .all<{ who: string }>()

  for (const { who } of results) await roomsRevoked(env, spaceId, who, 'none')
}

async function tell(
  namespace: DurableObjectNamespace,
  noteId: string,
  headers: Record<string, string>,
): Promise<boolean> {
  try {
    const room = namespace.get(namespace.idFromName(noteId))
    const answer = await room.fetch(new Request(`https://rooms.invalid/${noteId}`, { headers }))
    return answer.ok
  } catch {
    return false
  }
}

export async function closeRooms(
  env: Env,
  open: readonly { note_id: string; who: string }[],
): Promise<void> {
  const namespace = env.ROOMS
  if (!namespace) return

  for (const round of chunks(open, MOST_OPEN)) {
    await Promise.all(
      round.map((one) =>
        tell(namespace, one.note_id, { 'x-orden-revoked': one.who, 'x-orden-role': 'none' }),
      ),
    )
  }
}

export async function eraseRooms(env: Env, noteIds: readonly string[]): Promise<string[]> {
  const namespace = env.ROOMS
  if (!namespace) return [...noteIds]

  const emptied: string[] = []
  for (const round of chunks(noteIds, MOST_OPEN)) {
    const heard = await Promise.all(
      round.map((noteId) => tell(namespace, noteId, { 'x-orden-erase': 'yes' })),
    )
    emptied.push(...round.filter((_, at) => heard[at]))
  }

  return emptied
}

const MOST_SPACES = 100

export async function roomsSignedOut(env: Env, who: string): Promise<void> {
  if ((!env.ROOMS && !env.CHATS) || !who) return

  const { results } = await env.DB.prepare(
    `select space_id from room_sockets where who = ?1
     union select space_id from chat_sockets where who = ?1 limit ?2`,
  )
    .bind(who, MOST_SPACES)
    .all<{ space_id: string }>()

  for (const { space_id: spaceId } of results) {
    await roomsRevoked(env, spaceId, who, 'none')
  }
}
