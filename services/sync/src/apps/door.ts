/** The door to an application (issue 1063): `GET /v2/apps/:app/socket`.
 *
 *  As the online terminal's door: the token and the device ride in the subprotocols, and
 *  the host names itself with `nib.role.host`. An application is the reader's own and
 *  nobody else's: the file must be in a space the person owns, and only their own signed-in
 *  devices come in - as its host or as a viewer. While the switch is off (`apps` in
 *  `online_service`), or wherever the `APPS` binding is absent, this answers 404 like a
 *  route that does not exist, which an app that knows it reads as not available yet. */

import { HOST_PROTOCOL } from '@orden/online/apps'
import { tokenOf } from '@orden/rooms'
import { Hono } from 'hono'
import { now, sha256 } from '../crypto'
import { note } from '../failed'
import { NOT_FOUND, SIGN_IN } from '../refused'
import type { Env } from '../types'
import { deviceName } from '../locks/device-name'
import { WHO } from '../machines/reach'
import { appsOn } from './catalogue'

const DEVICE_PROTOCOL = 'nib.device.'
const DEVICE = /^[A-Za-z0-9_-]{8,64}$/
const AWAY = 'the application is not answering - try again'

export const appsDoor = new Hono<{ Bindings: Env }>()

export const OWNED = `select 1 as yes from notes n join spaces s on s.id = n.space_id
  where n.id = ?1 and s.user_id = ?2 and coalesce(n.deleted, 0) = 0 and s.deleted = 0`

appsDoor.get('/:app/socket', async (context) => {
  const env = context.env
  if (!(await appsOn(env))) return context.json({ error: NOT_FOUND }, 404)
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'an application is a websocket' }, 426)
  }

  const offered = (context.req.header('sec-websocket-protocol') ?? '')
    .split(',')
    .map((one) => one.trim())
  const hash = await sha256(tokenOf(offered.join(', ')) ?? '')
  const signed = await env.DB.prepare(`select who from (${WHO})`)
    .bind(hash, now())
    .first<{ who: string }>()
  if (!signed) return context.json({ error: SIGN_IN }, 401)
  const who = signed.who

  const device = offered
    .find((one) => one.startsWith(DEVICE_PROTOCOL))
    ?.slice(DEVICE_PROTOCOL.length)
  if (!device || !DEVICE.test(device)) {
    return context.json({ error: 'an application socket names its device' }, 400)
  }

  const app = context.req.param('app')
  const [owned, name] = await Promise.all([
    env.DB.prepare(OWNED).bind(app, who).first<{ yes: number }>(),
    deviceName(env, device, who),
  ])
  if (!owned) return context.json({ error: NOT_FOUND }, 404)

  const host = offered.includes(HOST_PROTOCOL)
  const namespace = env.APPS
  if (!namespace) return context.json({ error: NOT_FOUND }, 404)
  const answer = await namespace
    .get(namespace.idFromName(`${who}:${app}`))
    .fetch('https://app.invalid/join', {
      headers: {
        upgrade: 'websocket',
        'x-nib-app': 'join',
        'x-nib-app-id': app,
        'x-nib-who': who,
        'x-nib-login': hash,
        'x-nib-device': device,
        'x-nib-device-name': name,
        'x-nib-role': host ? 'host' : 'viewer',
      },
    })
    .catch((error: unknown) => {
      note(`app ${app}`, error, null)
      return null
    })
  if (!answer?.webSocket) return context.json({ error: AWAY }, 503, { 'retry-after': '1' })

  // The device's protocol named back, so the token is not written into a response.
  const headers = new Headers(answer.headers)
  headers.set('sec-websocket-protocol', `${DEVICE_PROTOCOL}${device}`)
  return new Response(answer.body, { status: answer.status, headers, webSocket: answer.webSocket })
})
