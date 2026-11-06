import { Hono } from 'hono'
import { subprotocol, tokenOf } from '@orden/rooms'
import { DEVICE_PROTOCOL } from '@orden/sync-core'
import { now, sha256 } from '../crypto'
import { note } from '../failed'
import { SIGN_IN } from '../refused'
import type { Env } from '../types'
import { askChat, CHAT_AWAY } from './ask'
import { reachByToken } from './reach'
import { NO_SUCH_CHAT } from './routes'

const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

function deviceIn(header: string | undefined): string | null {
  const offered = (header ?? '').split(',').map((one) => one.trim())
  const id = offered.find((one) => one.startsWith(DEVICE_PROTOCOL))?.slice(DEVICE_PROTOCOL.length)
  return id && DEVICE.test(id) ? id : null
}

export const chatDoor = new Hono<{ Bindings: Env }>()

chatDoor.get('/:chat/socket', async (context) => {
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'a chat socket is a websocket' }, 426)
  }

  const offered = context.req.header('sec-websocket-protocol')
  const token = tokenOf(offered) ?? ''
  const chat = context.req.param('chat')
  const { live, reached } = await reachByToken(context.env, await sha256(token), now(), chat)

  if (!live) return context.json({ error: SIGN_IN }, 401)
  if (!reached) return context.json({ error: NO_SUCH_CHAT }, 404)
  const device = deviceIn(offered)

  const answer = await askChat(context.env, chat, 'join', {
    upgrade: 'websocket',
    'x-nib-space': reached.space,
    'x-nib-who': reached.id,
    'x-nib-guest': reached.guest ? 'yes' : 'no',
    'x-nib-role': reached.role,
    ...(device ? { 'x-nib-device': device } : {}),
    'x-nib-login': await sha256(token),
  })

  if (!answer || (answer.status === 101 && !answer.webSocket)) {
    if (context.env.CHATS) note(`chat ${chat}`, new Error('the chat did not take the socket'), null)
    return context.json({ error: CHAT_AWAY }, 503, { 'retry-after': '1' })
  }

  const headers = new Headers(answer.headers)
  headers.set('sec-websocket-protocol', device ? `${DEVICE_PROTOCOL}${device}` : subprotocol(token))
  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers,
    webSocket: answer.webSocket,
  })
})
