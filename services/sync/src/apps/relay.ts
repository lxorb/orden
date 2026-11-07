import {
  type AppState,
  hostFrameOf,
  type RelayToHost,
  type RelayToViewer,
  type View,
  viewerFrameOf,
} from '@orden/online/apps'
import { note } from '../failed'
import type { Env } from '../types'
import { type Holder, SocketLock } from '../locks/sockets'
import { ASK_SIGNINS_EVERY, SIGNED_OUT, stillSignedIn } from '../signins'
import { OWNED } from './door'
import { steadyEnv } from '../steady'

export interface Party extends Holder {
  role: 'host' | 'viewer'
  login?: string
  hold?: boolean
  view?: View
}

const NOT_THEIRS = 4404

const STATE = 'state'

const OPEN = 1

function partyOf(socket: WebSocket): Party | null {
  const held: unknown = socket.deserializeAttachment()
  if (typeof held !== 'object' || held === null) return null
  const one = held as Partial<Party>
  if (typeof one.session !== 'string' || (one.role !== 'host' && one.role !== 'viewer')) return null
  return one as Party
}

function drives(party: Party): boolean {
  return party.role === 'viewer' && party.hold === true
}

function aside(at: string, work: Promise<unknown>): void {
  work.catch((error: unknown) => {
    note(at, error, null)
  })
}

export class AppRelay implements DurableObject {
  private readonly lock: SocketLock<Party>

  readonly env: Env

  constructor(
    private readonly ctx: DurableObjectState,
    env: Env,
  ) {
    this.env = steadyEnv(env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('beat', 'ok'))
    this.lock = new SocketLock<Party>({
      ctx,
      viewerOf: partyOf,
      drives,
      say: (socket, frame) => {
        this.say(socket, frame)
      },
      handed: (session) => {
        aside('app handed', this.toldWho(session))
      },
    })
  }

  fetch(request: Request): Response {
    if (request.headers.get('x-orden-app') !== 'join')
      return new Response('not something an application does', { status: 400 })
    const pair = new WebSocketPair()
    aside('app enter', this.enter(pair[1], partyFrom(request.headers)))
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async enter(socket: WebSocket, party: Party): Promise<void> {
    this.ctx.acceptWebSocket(socket, [party.session, party.role])
    socket.serializeAttachment(party)
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + ASK_SIGNINS_EVERY)
    }
    if (party.role === 'host') {
      for (const other of this.hosts(party.session)) {
        if (other !== socket) other.close(4409, 'another host')
      }
      this.toViewers(party.session, { t: 'host', up: true })
      await this.toldWho(party.session)
      return
    }
    this.say(socket, { t: 'host', up: this.hosts(party.session).length > 0 })
    const state = await this.ctx.storage.get<{ state: AppState; code?: number | null }>(STATE)
    if (state) this.say(socket, { t: 'state', ...state })
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    this.lock.heard(socket)
    const party = partyOf(socket)
    if (!party || typeof message !== 'string') return
    if (party.role === 'host') {
      await this.fromHost(party, message)
      return
    }

    const frame = viewerFrameOf(message)
    if (!frame) return
    switch (frame.t) {
      case 'hello': {
        const said: Party = {
          ...party,
          seen: Date.now(),
          ...(frame.hold ? { hold: true } : {}),
          ...(frame.view ? { view: frame.view } : {}),
        }
        socket.serializeAttachment(said)
        if (drives(said) && (await this.lock.claim(socket, false))) await this.toldWho(said.session)
        return
      }
      case 'take':
        if (drives(party) && (await this.lock.claim(socket, true))) this.say(socket, { t: 'hold' })
        return
      case 'leave':
        await this.lock.leave(socket)
        return
      case 'signal':
      case 'run':
        if (await this.holds(party)) this.toHost(party.session, frame)
        return
      case 'view':
        socket.serializeAttachment({ ...party, view: frame.view })
        if (await this.holds(party)) this.toHost(party.session, frame)
        return
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.gone(socket)
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.gone(socket)
  }

  async alarm(): Promise<void> {
    const sockets = this.ctx.getWebSockets().flatMap((socket) => {
      const party = partyOf(socket)
      return party ? [{ socket, party }] : []
    })
    const first = sockets[0]?.party
    if (!first) return

    const live = await stillSignedIn(
      this.env,
      sockets.flatMap(({ party }) => party.login ?? []),
    ).catch(() => null)
    const owned = await this.env.DB.prepare(OWNED)
      .bind(first.session, first.who)
      .first()
      .catch(() => undefined)
    for (const { socket, party } of sockets) {
      const ended = live && party.login !== undefined && !live.has(party.login)
      if (!ended && owned !== null) continue
      if (ended) socket.close(SIGNED_OUT, 'signed out')
      else socket.close(NOT_THEIRS, 'this application is gone')
      await this.gone(socket)
    }

    const held = await this.lock.holder(first.session)
    await this.lock.settle(first.session)
    if (held && !(await this.lock.holder(first.session))) await this.toldWho(first.session)

    if (this.ctx.getWebSockets().some((socket) => socket.readyState === OPEN)) {
      await this.ctx.storage.setAlarm(Date.now() + ASK_SIGNINS_EVERY)
    }
  }

  private async gone(socket: WebSocket): Promise<void> {
    const party = partyOf(socket)
    if (!party) return
    if (party.role === 'host') {
      const left = this.hosts(party.session).filter((one) => one !== socket)
      if (!left.length) this.toViewers(party.session, { t: 'host', up: false })
      return
    }
    if (drives(party) && !party.parked) await this.lock.settle(party.session, socket)
  }

  private async fromHost(party: Party, message: string): Promise<void> {
    const frame = hostFrameOf(message)
    if (!frame) return
    switch (frame.t) {
      case 'host':
        return
      case 'signal':
        for (const socket of this.ctx.getWebSockets(party.session)) {
          const one = partyOf(socket)
          if (one && drives(one) && !one.parked && (await this.holds(one))) this.say(socket, frame)
        }
        return
      case 'state': {
        const state = {
          state: frame.state,
          ...(frame.code === undefined ? {} : { code: frame.code }),
        }
        await this.ctx.storage.put(STATE, state)
        this.toViewers(party.session, frame)
        return
      }
    }
  }

  private async holds(party: Party): Promise<boolean> {
    if (!drives(party) || party.parked) return false
    return (await this.lock.holder(party.session))?.device === party.device
  }

  private async toldWho(session: string): Promise<void> {
    const hold = await this.lock.holder(session)
    this.toHost(session, { t: 'viewer', device: hold?.device ?? null, name: hold?.name ?? '' })
    if (!hold) return
    for (const socket of this.ctx.getWebSockets(session)) {
      const one = partyOf(socket)
      if (one?.device === hold.device && drives(one) && !one.parked && one.view) {
        this.toHost(session, { t: 'view', view: one.view })
        return
      }
    }
  }

  private hosts(session: string): WebSocket[] {
    return this.ctx
      .getWebSockets(session)
      .filter((socket) => socket.readyState === OPEN && partyOf(socket)?.role === 'host')
  }

  private toHost(session: string, frame: RelayToHost): void {
    for (const socket of this.hosts(session)) this.send(socket, frame)
  }

  private toViewers(session: string, frame: RelayToViewer): void {
    for (const socket of this.ctx.getWebSockets(session)) {
      if (partyOf(socket)?.role === 'viewer') this.send(socket, frame)
    }
  }

  private say(socket: WebSocket, frame: RelayToViewer): void {
    this.send(socket, frame)
  }

  private send(socket: WebSocket, frame: RelayToViewer | RelayToHost): void {
    try {
      socket.send(JSON.stringify(frame))
    } catch {
      // Closing or closed: its close handler deals with that.
    }
  }
}

function partyFrom(headers: Headers): Party {
  let name = ''
  try {
    name = decodeURIComponent(headers.get('x-orden-device-name') ?? '')
  } catch {
    // Not escaped words: no name.
  }
  const login = headers.get('x-orden-login')
  return {
    role: headers.get('x-orden-role') === 'host' ? 'host' : 'viewer',
    session: headers.get('x-orden-app-id') ?? '',
    device: headers.get('x-orden-device') ?? '',
    who: headers.get('x-orden-who') ?? '',
    ...(login ? { login } : {}),
    name,
    seen: Date.now(),
  }
}
