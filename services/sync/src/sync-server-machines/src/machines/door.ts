import { Hono } from 'hono'
import { tokenOf } from '@orden/rooms'
import { deviceOffered, type OfferedDevice } from '@orden/sync-core'
import { now, sha256, note, SIGN_IN, deviceName, type Env } from '../../../sync-server/src/api'
import { askMachine } from './ask'
import { whyNotWake } from './gate'
import { DOOR, reachedOf, type Row, WHO } from './reach'
import { refusedSocket } from './refuse'
import { serviceOf } from './service'

const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

export const NOT_FOUND = 'not found'
const AWAY = 'the machine is not answering - try again'

function deviceProtocol(header: string | undefined): OfferedDevice | null {
  const offered = deviceOffered(header)
  return offered && DEVICE.test(offered.device) ? offered : null
}

export const onlineDoor = new Hono<{ Bindings: Env }>()

onlineDoor.get('/:term/socket', async (context) => {
  const env = context.env
  const offered = context.req.header('sec-websocket-protocol')
  const hash = await sha256(tokenOf(offered) ?? '')
  const at = now()
  const term = context.req.param('term')

  const [service, row] = await Promise.all([
    serviceOf(env),
    env.DB.prepare(DOOR).bind(hash, at, term, '').first<Row>(),
  ])
  if (!service.on) return context.json({ error: NOT_FOUND }, 404)
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'an online terminal is a websocket' }, 426)
  }
  if (!row && !(await env.DB.prepare(WHO).bind(hash, at).first<{ who: string }>())) {
    return context.json({ error: SIGN_IN }, 401)
  }

  const named = deviceProtocol(offered)
  const device = named?.device
  if (!named || !device)
    return context.json({ error: 'an online terminal socket names its device' }, 400)

  const reached = row ? reachedOf(row) : null
  if (!reached) return refusedSocket('gone', named.protocol)

  const [wake, name] = await Promise.all([
    reached.owns ? whyNotWake(env, reached.owner, at, service).then((why) => why ?? 'yes') : 'no',
    deviceName(env, device, reached.who),
  ])
  const answer = await askMachine(env, reached.machine, 'join', {
    upgrade: 'websocket',
    'x-orden-user': reached.owner,
    'x-orden-who': reached.who,
    'x-orden-device': device,
    'x-orden-device-name': name,
    'x-orden-term': reached.term,
    'x-orden-session': reached.session,
    'x-orden-guest': reached.guest ? 'yes' : 'no',
    'x-orden-role': reached.role ?? '',
    'x-orden-owns': reached.owns ? 'yes' : 'no',
    'x-orden-typing': reached.typing,
    'x-orden-wake': wake,
    'x-orden-login': hash,
  })

  if (!answer || (answer.status === 101 && !answer.webSocket)) {
    note(`machine ${reached.machine}`, new Error('the machine did not take the socket'), null)
    return context.json({ error: AWAY }, 503, { 'retry-after': '1' })
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
