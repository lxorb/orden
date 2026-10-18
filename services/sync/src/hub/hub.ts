/** One account's hub: the socket every one of its signed-in devices keeps open.
 *
 *  A Durable Object named by the account's id (or a guest's), which makes it the one
 *  place every device of that account already agrees on. What happens here is pokes:
 *  a space moved, and every device that can reach it runs a pass now rather than at
 *  its next poll; and the like of them for the account's machine, its chats and its
 *  AI accounts. The hub also knows which devices are connected and in use, which is
 *  what a person's presence is worked out from (people/presence.ts).
 *
 *  It hibernates. Beats are answered by the runtime without waking it, and what each
 *  socket is lives on the socket, so an account whose devices are all quiet costs
 *  nothing. A guest's hub hears pokes and nothing else. See docs/sync-v2.md section
 *  5.12.
 *
 *  Until #393 the hub also held web-login leases and relayed the web key between
 *  computers (docs/sync-v2.md section 6). Both were removed with web logins that
 *  travel: what a hub kept for them in its storage is left there, unread, and goes
 *  with the rest when the account is erased. */

import { isWho } from '@nib/chats/wire'
import { note } from '../failed'
import { rollOn } from '../sync2/rollout'
import type { Env } from '../types'
import { markSeen, register } from './devices'
import { type FromDevice, readFrame, say } from './frames'
import { keepPresence, presenceOf } from '../people/presence'
import { type Attached, attach, attachedTo, everySocket, socketOf } from './sockets'

/** The heartbeat, both halves, as the runtime answers it. */
const BEAT = 'beat'
const BEAT_ANSWER = 'ok'

/** What the door decided about a socket before handing it here. */
export interface Joining {
  device: string
  who: string
  session: string
  guest: boolean
}

export class AccountHub implements DurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(BEAT, BEAT_ANSWER))
  }

  /** What a route asks, named by a header; see reach.ts. */
  async fetch(request: Request): Promise<Response> {
    const headers = request.headers
    switch (headers.get('x-nib-hub') ?? '') {
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
        // The AI accounts moved (ai/vault.ts): every device of the account but the
        // one whose change it was reads them again.
        for (const { socket, attached } of everySocket(this.ctx)) {
          if (!attached.guest && attached.device !== (headers.get('x-nib-from') ?? '')) {
            say(socket, { t: 'ai' })
          }
        }
        return new Response(null, { status: 204 })
      default:
        return new Response('not something a hub does', { status: 400 })
    }
  }

  private join(headers: Headers): Response {
    const pair = new WebSocketPair()
    this.enter(pair[1], {
      device: headers.get('x-nib-device') ?? '',
      who: headers.get('x-nib-who') ?? '',
      session: headers.get('x-nib-session') ?? '',
      guest: headers.get('x-nib-guest') === 'yes',
    })
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** The hub's half of a socket, taken in. Apart from `fetch` because a test drives
   *  it without a runtime to make the pair. A device has one socket: one that
   *  connects again replaces the one it had, which is a socket the network has not
   *  yet told anybody is dead. */
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

  /** An alarm a hub set for a web-login lease before #393, going off once: nothing is
   *  waited for any more. */
  alarm(): void {
    // Nothing to do; see above.
  }

  /* ── Devices ──────────────────────────────────────────────────────────── */

  /** A device saying who it is. For an account that is a row in `devices`, bound
   *  to the session its socket carries. */
  private async hello(
    socket: WebSocket,
    me: Attached,
    frame: Extract<FromDevice, { t: 'hello' }>,
  ): Promise<void> {
    // A socket speaks for the device it connected as, and for nobody else.
    if (frame.device !== me.device) return

    if (me.guest) {
      attach(socket, { ...me, hello: true })
      return
    }

    await register(this.env, me.who, me.session, frame)
    attach(socket, { ...me, hello: true })
    await this.present(me.who)
    // The moment a device says which app it runs is when its account may have become
    // safe to move to sync v2; see sync2/rollout.ts. Never in the way of the hello.
    await rollOn(this.env, me.who).catch((error: unknown) => note('sync rollout', error, null))
  }

  /** A device's person came back, or went away. */
  private async activity(socket: WebSocket, me: Attached, active: boolean): Promise<void> {
    if (me.active === active) return
    attach(socket, { ...me, active })
    if (!me.guest) await this.present(me.who)
  }

  /** A socket that closed, or broke: unless its device has another socket, the
   *  account learns when it was last here. */
  private async gone(socket: WebSocket): Promise<void> {
    const me = attachedTo(socket)

    if (me && !me.guest && me.hello && !socketOf(this.ctx, me.device, socket)) {
      await markSeen(this.env, me.who, me.device)
    }
    if (me && !me.guest) await this.present(me.who, socket)
  }

  /** Whether the account's person is here, written down when it changed: active while
   *  a device is in use, away while one is connected, offline with none. See
   *  people/presence.ts. */
  private async present(user: string, closing?: WebSocket): Promise<void> {
    const state = presenceOf(everySocket(this.ctx, closing).map(({ attached }) => attached))
    await keepPresence(this.env, user, state)
  }

  /** A device was ended from another: its sockets closed. */
  private revoke(headers: Headers): Response {
    const device = headers.get('x-nib-device') ?? ''
    for (const socket of this.ctx.getWebSockets(device)) {
      socket.close(1008, 'this device was signed out')
    }
    return new Response(null, { status: 204 })
  }

  /** The account is gone, and so is everything this hub kept for it. */
  private async erase(): Promise<Response> {
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, 'no longer an account')
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    return new Response(null, { status: 204 })
  }

  /* ── Pokes ────────────────────────────────────────────────────────────── */

  /** A space this account can reach moved. Every socket hears it but the device
   *  whose write it was, and nothing is read or written to hear it. */
  private poke(headers: Headers): void {
    const space = headers.get('x-nib-space') ?? ''
    const seq = Number(headers.get('x-nib-seq') ?? '')
    const from = headers.get('x-nib-from') ?? ''
    if (!space || !Number.isSafeInteger(seq)) return

    for (const { socket, attached } of everySocket(this.ctx)) {
      if (attached.device !== from) say(socket, { t: 'poke', space, seq })
    }
  }

  /** The account's online terminal machine changed state (docs/online-terminal.md,
   *  4.6): every device of the account hears it. Only an account's own hub is asked;
   *  a guest has no machine. */
  private machine(headers: Headers): void {
    const state = headers.get('x-nib-state')
    if (state !== 'asleep' && state !== 'starting' && state !== 'awake' && state !== 'stopping') {
      return
    }
    for (const { socket, attached } of everySocket(this.ctx)) {
      if (!attached.guest) say(socket, { t: 'machine', state })
    }
  }

  /** A chat this account reaches moved while none of its devices had it open: every
   *  device hears it, coalesced by the chat's `ChatLog` (chats/log.ts), and moves the
   *  chat's count; the words are pulled when it notifies or the chat opens. */
  private chat(headers: Headers): void {
    const chat = headers.get('x-nib-chat') ?? ''
    const seq = Number(headers.get('x-nib-seq') ?? '')
    const at = Number(headers.get('x-nib-at') ?? '')
    const by = headers.get('x-nib-by')
    if (!chat || !isWho(by) || !Number.isSafeInteger(seq) || !Number.isSafeInteger(at)) return

    const mention = headers.get('x-nib-mention') === 'yes'
    for (const { socket } of everySocket(this.ctx)) {
      say(socket, { t: 'chat', chat, seq, at, by, mention })
    }
  }
}
