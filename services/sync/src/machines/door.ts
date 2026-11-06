import { Hono } from 'hono'
import { tokenOf } from '@orden/rooms'
import { now, sha256 } from '../crypto'
import { note } from '../failed'
import { SIGN_IN } from '../refused'
import type { Env } from '../types'
import { askMachine } from './ask'
import { whyNotWake } from './gate'
import { deviceName } from '../locks/device-name'
import { DOOR, reachedOf, type Row, WHO } from './reach'
import { refusedSocket } from './refuse'
import { serviceOf } from './service'

const DEVICE_PROTOCOL = 'nib.device.'
const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

export const NOT_FOUND = 'not found'
const AWAY = 'the machine is not answering - try again'

function deviceProtocol(header: string | undefined): string | null {
  const offered = (header ?? '').split(',').map((one) => one.trim())
  const id = offered.find((one) => one.startsWith(DEVICE_PROTOCOL))?.slice(DEVICE_PROTOCOL.length)
  return id && DEVICE.test(id) ? id : null
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

  const device = deviceProtocol(offered)
  if (!device) return context.json({ error: 'an online terminal socket names its device' }, 400)

  const reached = row ? reachedOf(row) : null
  if (!reached) return refusedSocket('gone', `${DEVICE_PROTOCOL}${device}`)

  const [wake, name] = await Promise.all([
    reached.owns ? whyNotWake(env, reached.owner, at, service).then((why) => why ?? 'yes') : 'no',
    deviceName(env, device, reached.who),
  ])
  const answer = await askMachine(env, reached.machine, 'join', {
    upgrade: 'websocket',
    'x-nib-user': reached.owner,
    'x-nib-who': reached.who,
    'x-nib-device': device,
    'x-nib-device-name': name,
    'x-nib-term': reached.term,
    'x-nib-session': reached.session,
    'x-nib-guest': reached.guest ? 'yes' : 'no',
    'x-nib-role': reached.role ?? '',
    'x-nib-owns': reached.owns ? 'yes' : 'no',
    'x-nib-typing': reached.typing,
    'x-nib-wake': wake,
    'x-nib-login': hash,
  })

  if (!answer || (answer.status === 101 && !answer.webSocket)) {
    note(`machine ${reached.machine}`, new Error('the machine did not take the socket'), null)
    return context.json({ error: AWAY }, 503, { 'retry-after': '1' })
  }

  const headers = new Headers(answer.headers)
  headers.set('sec-websocket-protocol', `${DEVICE_PROTOCOL}${device}`)
  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers,
    webSocket: answer.webSocket,
  })
})
