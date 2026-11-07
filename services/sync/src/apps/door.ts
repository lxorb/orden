import { HOST_PROTOCOLS, UNKNOWN_APP } from '@orden/online/apps'
import { tokenOf } from '@orden/rooms'
import { deviceOffered } from '@orden/sync-core'
import { Hono } from 'hono'
import { now, sha256 } from '../crypto'
import { note } from '../failed'
import { NOT_FOUND, SIGN_IN } from '../refused'
import type { Env } from '../types'
import { deviceName } from '../locks/device-name'
import { WHO } from '../machines/reach'
import { appsOn } from './catalogue'

const DEVICE = /^[A-Za-z0-9_-]{8,64}$/
const AWAY = 'the application is not answering - try again'

export const appsDoor = new Hono<{ Bindings: Env }>()

export const OWNED = `select 1 as yes from notes n join spaces s on s.id = n.space_id
  where n.id = ?1 and s.user_id = ?2 and coalesce(n.deleted, 0) = 0 and s.deleted = 0`

appsDoor.get('/:app/socket', async (context) => {
  const env = context.env
  const namespace = env.APPS
  if (!namespace || !(await appsOn(env))) return context.json({ error: NOT_FOUND }, 404)
  const socket = context.req.header('upgrade')?.toLowerCase() === 'websocket'

  const offered = (context.req.header('sec-websocket-protocol') ?? '')
    .split(',')
    .map((one) => one.trim())
  const token = socket
    ? tokenOf(offered.join(', '))
    : /^Bearer (.+)$/.exec(context.req.header('authorization') ?? '')?.[1]
  const hash = await sha256(token ?? '')
  const signed = await env.DB.prepare(`select who from (${WHO})`)
    .bind(hash, now())
    .first<{ who: string }>()
  if (!signed) return context.json({ error: SIGN_IN }, 401)
  const who = signed.who
  const app = context.req.param('app')

  if (!socket) {
    const owned = await env.DB.prepare(OWNED).bind(app, who).first<{ yes: number }>()
    if (!owned) return context.json({ error: UNKNOWN_APP }, 404)
    return context.json({ error: 'an application is a websocket' }, 426)
  }

  const named = deviceOffered(offered.join(', '))
  const device = named?.device
  if (!named || !device || !DEVICE.test(device)) {
    return context.json({ error: 'an application socket names its device' }, 400)
  }

  const [owned, name] = await Promise.all([
    env.DB.prepare(OWNED).bind(app, who).first<{ yes: number }>(),
    deviceName(env, device, who),
  ])
  if (!owned) return context.json({ error: UNKNOWN_APP }, 404)

  const host = offered.some((one) => HOST_PROTOCOLS.includes(one))
  const answer = await namespace
    .get(namespace.idFromName(`${who}:${app}`))
    .fetch('https://app.invalid/join', {
      headers: {
        upgrade: 'websocket',
        'x-orden-app': 'join',
        'x-orden-app-id': app,
        'x-orden-who': who,
        'x-orden-login': hash,
        'x-orden-device': device,
        'x-orden-device-name': name,
        'x-orden-role': host ? 'host' : 'viewer',
      },
    })
    .catch((error: unknown) => {
      note(`app ${app}`, error, null)
      return null
    })
  if (!answer?.webSocket) return context.json({ error: AWAY }, 503, { 'retry-after': '1' })

  const headers = new Headers(answer.headers)
  headers.set('sec-websocket-protocol', named.protocol)
  return new Response(answer.body, { status: answer.status, headers, webSocket: answer.webSocket })
})
