import { isWho } from '@orden/chats/wire'
import { note } from '../failed'
import { guestSignedIn } from '../guests'
import { rollOn } from '../sync2/rollout'
import type { Env } from '../types'
import { markSeen, register } from './devices'
import { type FromDevice, readFrame, say } from './frames'
import { keepPresence, presenceOf } from '../people/presence'
import { type Attached, attach, attachedTo, everySocket, socketOf } from './sockets'
import { steadyEnv } from '../steady'

const BEAT = 'beat'
const BEAT_ANSWER = 'ok'

export interface Joining {
  device: string
  who: string
  session: string
  guest: boolean
}

export class AccountHub implements DurableObject {
  private readonly env: Env

  constructor(
    private readonly ctx: DurableObjectState,
    env: Env,
  ) {
    this.env = steadyEnv(env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(BEAT, BEAT_ANSWER))
  }

  async fetch(request: Request): Promise<Response> {
    const headers = request.headers
    switch (headers.get('x-orden-hub') ?? '') {
      case 'join':
        return this.join(headers)
      case 'poke':
        this.poke(headers)
        return new Response(null, { status: 204 })
      case 'revoke':
        return this.revoke(headers)
      case 'erase':
        return await this.erase()
      case 'machine':
        this.machine(headers)
        return new Response(null, { status: 204 })
      case 'terms':
        for (const { socket, attached } of everySocket(this.ctx)) {
          if (!attached.guest) say(socket, { t: 'terms' })
        }
        return new Response(null, { status: 204 })
      case 'chat':
        this.chat(headers)
        return new Response(null, { status: 204 })
      case 'ai':
        this.others(headers, 'ai')
        return new Response(null, { status: 204 })
      case 'pass':
        this.others(headers, 'pass')
        return new Response(null, { status: 204 })
      case 'settings':
        this.others(headers, 'settings')
        return new Response(null, { status: 204 })
      default:
        return new Response('not something a hub does', { status: 400 })
    }
  }

  private others(headers: Headers, t: 'ai' | 'pass' | 'settings'): void {
    const from = headers.get('x-orden-from') ?? ''
    for (const { socket, attached } of everySocket(this.ctx)) {
      if (!attached.guest && attached.device !== from) say(socket, { t })
    }
  }

  private join(headers: Headers): Response {
    const pair = new WebSocketPair()
    this.enter(pair[1], {
      device: headers.get('x-orden-device') ?? '',
      who: headers.get('x-orden-who') ?? '',
      session: headers.get('x-orden-session') ?? '',
      guest: headers.get('x-orden-guest') === 'yes',
    })
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  enter(server: WebSocket, joining: Joining): void {
    for (const old of this.ctx.getWebSockets(joining.device)) {
      if (old !== server) old.close(4000, 'this device connected again')
    }

    this.ctx.acceptWebSocket(server, [joining.device])
    attach(server, { ...joining, active: true, hello: false })
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== 'string') return

    const me = attachedTo(socket)
    const frame = readFrame(message)
    if (!me || !frame) return

    if (frame.t === 'active' || frame.t === 'idle') {
      await this.activity(socket, me, frame.t === 'active')
      return
    }

    await this.hello(socket, me, frame)
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.gone(socket)
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.gone(socket)
  }

  alarm(): void {
    // Nothing to do; see above.
  }

  private async hello(
    socket: WebSocket,
    me: Attached,
    frame: Extract<FromDevice, { t: 'hello' }>,
  ): Promise<void> {
    if (frame.device !== me.device) return

    if (me.guest) {
      if (!(await guestSignedIn(this.env, me.who, me.session))) {
        socket.close(1008, 'this device was signed out')
        return
      }
      attach(socket, { ...me, hello: true })
      return
    }

    if (!(await register(this.env, me.who, me.session, frame))) {
      socket.close(1008, 'this device was signed out')
      return
    }
    attach(socket, { ...me, hello: true })
    await this.present(me.who)
    await rollOn(this.env, me.who).catch((error: unknown) => note('sync rollout', error, null))
  }

  private async activity(socket: WebSocket, me: Attached, active: boolean): Promise<void> {
    if (me.active === active) return
    attach(socket, { ...me, active })
    if (!me.guest) await this.present(me.who)
  }

  private async gone(socket: WebSocket): Promise<void> {
    const me = attachedTo(socket)

    if (me && !me.guest && me.hello && !socketOf(this.ctx, me.device, socket)) {
      await markSeen(this.env, me.who, me.device)
    }
    if (me && !me.guest) await this.present(me.who, socket)
  }

  private async present(user: string, closing?: WebSocket): Promise<void> {
    const state = presenceOf(everySocket(this.ctx, closing).map(({ attached }) => attached))
    await keepPresence(this.env, user, state)
  }

  private revoke(headers: Headers): Response {
    const device = headers.get('x-orden-device') ?? ''
    for (const socket of this.ctx.getWebSockets(device)) {
      socket.close(1008, 'this device was signed out')
    }
    const sessions = headers.get('x-orden-sessions')?.split(',') ?? []
    for (const { socket, attached } of everySocket(this.ctx)) {
      if (sessions.includes(attached.session)) socket.close(1008, 'this device was signed out')
    }
    return new Response(null, { status: 204 })
  }

  private async erase(): Promise<Response> {
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, 'no longer an account')
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    return new Response(null, { status: 204 })
  }

  private poke(headers: Headers): void {
    const space = headers.get('x-orden-space') ?? ''
    const seq = Number(headers.get('x-orden-seq') ?? '')
    const from = headers.get('x-orden-from') ?? ''
    if (!space || !Number.isSafeInteger(seq)) return

    for (const { socket, attached } of everySocket(this.ctx)) {
      if (attached.device !== from) say(socket, { t: 'poke', space, seq })
    }
  }

  private machine(headers: Headers): void {
    const state = headers.get('x-orden-state')
    if (state !== 'asleep' && state !== 'starting' && state !== 'awake' && state !== 'stopping') {
      return
    }
    for (const { socket, attached } of everySocket(this.ctx)) {
      if (!attached.guest) say(socket, { t: 'machine', state })
    }
  }

  private chat(headers: Headers): void {
    const chat = headers.get('x-orden-chat') ?? ''
    const seq = Number(headers.get('x-orden-seq') ?? '')
    const at = Number(headers.get('x-orden-at') ?? '')
    const by = headers.get('x-orden-by')
    if (!chat || !isWho(by) || !Number.isSafeInteger(seq) || !Number.isSafeInteger(at)) return

    const mention = headers.get('x-orden-mention') === 'yes'
    for (const { socket } of everySocket(this.ctx)) {
      say(socket, { t: 'chat', chat, seq, at, by, mention })
    }
  }
}
