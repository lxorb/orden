import { Hono } from 'hono'
import { tokenOf } from '@orden/rooms'
import { deviceOffered, type OfferedDevice } from '@orden/sync-core'
import { now, sha256 } from '../crypto'
import { note } from '../failed'
import { SIGN_IN } from '../refused'
import type { Env } from '../types'
import { DEVICE } from './frames'
import { askHub, HUB_AWAY } from './reach'

const WHO = `with me as (
  select s.user_id as user_id, s.id as session_id, null as guest_id
    from sessions s where s.token_hash = ?1 and s.expires_at > ?2
  union all
  select null as user_id, null as session_id, g.guest_id as guest_id
    from guest_sessions g where g.token_hash = ?1 and g.expires_at > ?2
)
select me.user_id as user_id, me.session_id as session_id, me.guest_id as guest_id,
       d.user_id as owner, d.session_id as bound,
       (select 1 from sessions b where b.id = d.session_id and b.expires_at > ?2) as bound_alive
  from me left join devices d on d.id = ?3`

function deviceProtocol(header: string | undefined): OfferedDevice | null {
  const offered = deviceOffered(header)
  return offered && DEVICE.test(offered.device) ? offered : null
}

export const hubDoor = new Hono<{ Bindings: Env }>()

hubDoor.get('/', async (context) => {
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'a hub is a websocket' }, 426)
  }

  const offered = context.req.header('sec-websocket-protocol')
  const token = tokenOf(offered)
  const named = deviceProtocol(offered)
  const device = named?.device ?? null

  const tokenHash = await sha256(token ?? '')
  const row = await context.env.DB.prepare(WHO)
    .bind(tokenHash, now(), device ?? '')
    .first<{
      user_id: string | null
      session_id: string | null
      guest_id: string | null
      owner: string | null
      bound: string | null
      bound_alive: number | null
    }>()

  const who = row?.user_id ?? row?.guest_id
  if (!row || !who) return context.json({ error: SIGN_IN }, 401)
  if (!named || !device) return context.json({ error: 'a hub socket names its device' }, 400)

  if (row.user_id) {
    if (row.owner && row.owner !== row.user_id) {
      return context.json({ error: 'that device belongs to another account' }, 403)
    }
    if (row.bound && row.bound !== row.session_id && row.bound_alive) {
      return context.json({ error: 'that device is signed in with another session' }, 409)
    }
  }

  const answer = await askHub(context.env, who, 'join', {
    upgrade: 'websocket',
    'x-orden-device': device,
    'x-orden-who': who,
    'x-orden-session': row.session_id ?? tokenHash,
    'x-orden-guest': row.user_id ? 'no' : 'yes',
  })

  if (!answer || (answer.status === 101 && !answer.webSocket)) {
    if (context.env.HUB) note(`hub ${who}`, new Error('the hub did not take the socket'), null)
    return context.json({ error: HUB_AWAY }, 503, {
      'retry-after': '1',
    })
  }

  const headers = new Headers(answer.headers)
  headers.set('sec-websocket-protocol', named.protocol)

  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers,
    webSocket: answer.webSocket,
  })
})
