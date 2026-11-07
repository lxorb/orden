import { BEAT, BEAT_ANSWER } from '@orden/sync-core/wire'
import { randomToken } from '../crypto'
import { note } from '../failed'
import { askHub } from '../hub/reach'
import type { Env } from '../types'
import { audit, type Detail, failureOf, type Step } from './audit'
import { budgetLeft } from './budget'
import { whyNotWake } from './gate'
import { HostRefused } from './hetzner-host'
import { hostOf, SECRET } from './host'
import { meter, usedOf } from './meter'
import {
  type Activity,
  awake,
  ALLOWANCE,
  type Disk,
  diskFull,
  type HostKind,
  type MachineHost,
  type MachineState,
  mayType,
  OFF,
  sizeOf,
  SMALL,
  type SpaceRole,
  type Typed,
  type Typing,
  type Watcher,
} from '@orden/online'
import {
  type ClientFrame,
  clientFrameOf,
  type DownReason,
  INPUT_RATE,
  linkFrame,
  type MachineFrame,
  MOST_INPUT,
  MOST_SOCKETS,
  nibdFrameOf,
  type NibdFrame,
  outFrame,
  PING_EVERY,
  QUIET_FOR,
  type Refusal,
  REFUSALS,
  type ServerFrame,
  type SessionNow,
  text,
} from '@orden/online/wire'
import { SocketLock } from '../locks/sockets'
import { reachAgain } from './reach'
import { stillSignedIn } from '../signins'
import { serviceOf } from './service'
import { steadyEnv } from '../steady'

function aside(at: string, work: Promise<unknown>): void {
  work.catch((error: unknown) => {
    note(at, error, null)
  })
}

const IMAGE = 'machine'

const HOME = '/home/nib'

const MINUTE = 60_000
const ACTIVE_FOR = 5 * MINUTE
const RECENT_FOR = 15 * MINUTE
const BUDGET_GRACE = 10 * MINUTE
const SNAPSHOT_KEPT = 30 * 24 * 60 * MINUTE
const BACKUP_EVERY = 6 * 60 * MINUTE
const SAVE_WAIT = 15_000
const STOP_GRACE = 15_000
const START_LIMIT = 90_000
const RESTORE_LIMIT = 120_000
const SAVE_LIMIT = 120_000
const LINK_LIMIT = 20_000
const RESTART_SAVE_LIMIT = 60_000

const TYPING_FOR = 2_000
const SEEN_EVERY = MINUTE
const OPENS_A_MINUTE = 10
const CALLBACKS_A_MINUTE = 10

const LIST_WAIT = 3_000

const PROVISION_EVERY = 10_000
const FIRST_LOOK = 1_000
const FIRST_BOOT_LIMIT = 20 * MINUTE
const REBOOT_AFTER = 3 * MINUTE
const REBOOT_LIMIT = 10 * MINUTE
const SILENT_AGAIN = 5 * MINUTE

const ME = 'me'
const HOST = 'host'
const PROVISION = 'provision'
const STATE = 'state'
const DOWN = 'down'
const RECENT = 'recent'
const METERED = 'metered'
const GRACE = 'grace'
const RESTORED = 'restored'
const KEPT_ABOVE = 5
const REFUSED_SOCKET = 'refused'
const ENDING = 'ending'

interface Booted {
  server_id: number | null
  snapshot: string | null
  snapshot_at: number | null
  snapshot_image: string | null
  backup: string | null
}

export interface Viewer {
  who: string
  device: string
  term: string
  session: string
  guest: boolean
  role: SpaceRole | null
  owns: boolean
  typing: Typing
  cols: number
  rows: number
  seen: number
  login?: string
  name?: string
  hold?: boolean
  parked?: boolean
  lost?: boolean
}

const loginTag = (login: string) => `login:${login}`

interface Me {
  id: string
  user: string
}

interface Provision {
  since: number
  why: 'boot' | 'recover'
  rebooted: boolean
}

interface SessionNews {
  program?: Extract<ServerFrame, { t: 'program' }>
  ended?: Extract<ServerFrame, { t: 'ended' }>
  size?: Extract<ServerFrame, { t: 'size' }>
}

const OPEN = 1
const encoder = new TextEncoder()

function capped<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what} took longer than ${String(ms)} ms`)), ms)
  })
  return Promise.race([promise, late]).finally(() => {
    if (timer !== null) clearTimeout(timer)
  })
}

function viewerOf(socket: WebSocket): Viewer | null {
  const held: unknown = socket.deserializeAttachment()
  if (typeof held !== 'object' || held === null) return null
  const one = held as Partial<Viewer>
  if (typeof one.who !== 'string' || typeof one.session !== 'string') return null
  return one as Viewer
}

export class Machine implements DurableObject {
  private readonly given: MachineHost | null
  private made: { kind: HostKind; host: MachineHost } | null = null
  private link: WebSocket | null = null
  private waking: Promise<void> | null = null
  private readonly next = new Map<WebSocket, number>()
  private readonly typed = new Map<string, Typed[]>()
  private readonly ends = new Map<string, number>()
  private readonly news = new Map<string, SessionNews>()
  private readonly rate = new Map<string, { second: number; count: number }>()
  private readonly lastKey = new Map<string, number>()
  private readonly lastDevice = new Map<string, string>()
  private opens = { minute: 0, count: 0 }
  private callbacks = { minute: 0, count: 0 }
  private pending = { cpuS: 0, egressBytes: 0, homeBytes: -1 }
  private saved: (() => void) | null = null
  private sleeping = false
  private heard = 0
  private recovering: Promise<void> | null = null
  private restoring: Promise<void> | null = null
  private disk: Disk | null = null
  private diskSaid = false
  private relinked = 0
  private backupNow = false
  private listing: ((sessions: SessionNow[] | null) => void)[] = []
  private readonly lock: SocketLock<Viewer>

  private readonly env: Env

  constructor(
    private readonly ctx: DurableObjectState,
    env: Env,
    host?: MachineHost,
  ) {
    this.env = steadyEnv(env)
    this.given = host ?? null
    this.lock = new SocketLock<Viewer>({
      ctx,
      viewerOf,
      drives,
      say: (socket, frame) => {
        this.say(socket, frame)
      },
      parked: (socket) => this.next.set(socket, -1),
      handed: (session) => {
        this.people(session)
      },
    })
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(BEAT, BEAT_ANSWER))
  }

  private async host(): Promise<MachineHost> {
    if (this.given) return this.given
    const kind = await this.kind()
    if (this.made?.kind !== kind) this.made = { kind, host: hostOf(kind, this.ctx, this.env) }
    return this.made.host
  }

  private async kind(): Promise<HostKind> {
    if (this.made) return this.made.kind
    const me = await this.me()
    const row = me
      ? await this.env.DB.prepare('select host from machines where id = ?')
          .bind(me.id)
          .first<{ host: HostKind }>()
      : null
    if (row) {
      await this.ctx.storage.put(HOST, row.host)
      return row.host
    }
    return (await this.ctx.storage.get<HostKind>(HOST)) ?? 'cloudflare'
  }

  async fetch(request: Request): Promise<Response> {
    const headers = request.headers
    await this.remember(headers)
    switch (headers.get('x-nib-machine') ?? '') {
      case 'join':
        return this.join(headers)
      case 'start':
        await this.wake()
        return Response.json({ state: await this.state() })
      case 'stop':
        await this.sleep(downOf(headers.get('x-nib-reason')))
        return Response.json({ state: await this.state() })
      case 'state':
        return Response.json({ state: await this.state() })
      case 'typing':
        this.retype(headers.get('x-nib-term') ?? '', headers.get('x-nib-typing'))
        return new Response(null, { status: 204 })
      case 'signedout':
        this.signedOut((headers.get('x-nib-logins') ?? '').split(',').filter(Boolean))
        return new Response(null, { status: 204 })
      case 'revoke':
        this.revoke(headers.get('x-nib-who') ?? '', headers.get('x-nib-role'), headers)
        return new Response(null, { status: 204 })
      case 'end':
        await this.end(headers.get('x-nib-session') ?? '')
        return new Response(null, { status: 204 })
      case 'erase':
        return await this.erase(headers.get('x-nib-id'))
      case 'restart':
        await this.restartNibd(headers.get('x-nib-who'))
        return Response.json({ state: await this.state() })
      case 'reboot':
        await this.reboot()
        return Response.json({ state: await this.state() })
      case 'host':
        await this.move(headers.get('x-nib-host') === 'hetzner' ? 'hetzner' : 'cloudflare')
        return Response.json({ state: await this.state() })
      case 'sessions':
        return Response.json({ sessions: await this.sessions() })
      default:
        return new Response('not something a machine does', { status: 400 })
    }
  }

  private async remember(headers: Headers): Promise<void> {
    const id = headers.get('x-nib-id')
    const user = headers.get('x-nib-user')
    if (!id || !user) return
    const known = await this.ctx.storage.get<Me>(ME)
    if (known?.id !== id || known.user !== user) await this.ctx.storage.put(ME, { id, user })
  }

  private join(headers: Headers): Response {
    const pair = new WebSocketPair()
    aside(
      'machine enter',
      this.enter(pair[1], viewerFrom(headers), headers.get('x-nib-wake') ?? 'no'),
    )
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async enter(server: WebSocket, viewer: Viewer, wake: string): Promise<void> {
    const invitedWriter = !viewer.guest && viewer.role === 'write'
    const room = viewer.owns ? MOST_SOCKETS : MOST_SOCKETS - KEPT_ABOVE * (invitedWriter ? 1 : 2)
    if (this.ctx.getWebSockets(viewer.session).length >= room) {
      this.ctx.acceptWebSocket(server, [REFUSED_SOCKET])
      this.say(server, { t: 'refused', error: 'rate' })
      server.close(4429, 'too many sockets on this terminal')
      return
    }

    this.ctx.acceptWebSocket(server, [
      viewer.session,
      viewer.who,
      ...(viewer.login ? [loginTag(viewer.login)] : []),
    ])
    server.serializeAttachment(viewer)
    this.next.set(server, -1)

    const state = await this.state()
    this.say(server, { t: 'role', type: maySocketType(viewer) })
    const reason = await this.down()
    this.say(server, { t: 'machine', state, ...(reason ? { reason } : {}) })
    const news = this.news.get(viewer.session)
    if (news?.size) this.say(server, news.size)
    if (news?.program) this.say(server, news.program)
    if (news?.ended) this.say(server, news.ended)
    if (this.diskSaid) this.say(server, { t: 'note', note: 'disk' })
    this.people(viewer.session)

    const me = await this.me()
    if (me) {
      await audit(this.env, me.id, 'open', {
        who: viewer.who,
        device: viewer.device,
        detail: viewer.guest ? 'guest' : viewer.owns ? 'owner' : viewer.role,
      })
    }

    if (state === 'asleep' && viewer.owns) {
      if (wake === 'yes') await this.wake()
      else if (isRefusal(wake)) this.say(server, { t: 'refused', error: wake })
    }
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    this.lock.heard(socket)
    const viewer = viewerOf(socket)
    if (!viewer) return

    if (typeof message !== 'string') {
      if (!viewer.parked) this.input(socket, viewer, new Uint8Array(message))
      return
    }

    const frame = clientFrameOf(message)
    if (!frame) return
    if (viewer.parked && frame.t !== 'hello' && frame.t !== 'take' && frame.t !== 'leave') return
    switch (frame.t) {
      case 'hello': {
        const said = {
          ...viewer,
          cols: frame.cols,
          rows: frame.rows,
          ...(frame.hold ? { hold: true } : {}),
        }
        socket.serializeAttachment(said)
        if (drives(said) && !(await this.lock.claim(socket, false))) break
        await this.hello(socket, viewerOf(socket) ?? said, frame.since)
        break
      }
      case 'take':
        if (!drives(viewer)) this.say(socket, { t: 'refused', error: 'role' })
        else if (await this.lock.claim(socket, true)) this.say(socket, { t: 'hold' })
        break
      case 'leave':
        await this.lock.leave(socket)
        break
      case 'in':
        this.input(socket, viewer, encoder.encode(frame.data))
        break
      case 'size':
        this.resized(socket, { ...viewer, cols: frame.cols, rows: frame.rows })
        break
      case 'start':
        if (!maySocketType(viewer)) this.say(socket, { t: 'refused', error: 'role' })
        else
          this.tell(viewer.session, { t: 'open', session: viewer.session, ...this.sizeFor(viewer) })
        break
      case 'resume':
        await this.resume(socket, viewer)
        break
      case 'callback':
        this.callback(socket, viewer, frame.url)
        break
      case 'image':
        this.image(socket, viewer, frame)
        break
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.gone(socket)
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.gone(socket)
  }

  private async gone(socket: WebSocket): Promise<void> {
    this.next.delete(socket)
    const viewer = viewerOf(socket)
    if (!viewer) return
    if (drives(viewer) && !viewer.parked) await this.lock.settle(viewer.session, socket)
    this.people(viewer.session, socket)
    const me = await this.me()
    if (me) await audit(this.env, me.id, 'close', { who: viewer.who, device: viewer.device })
  }

  private async hello(socket: WebSocket, viewer: Viewer, since?: number): Promise<void> {
    socket.serializeAttachment({ ...viewer, seen: Date.now() })
    this.next.set(socket, since ?? -1)
    this.ensureOpen(viewer)
    if (drives(viewer)) this.typedBy(viewer, Date.now())
    else if (maySocketType(viewer) && !this.typed.get(viewer.session)?.length) {
      this.tell(viewer.session, {
        t: 'size',
        session: viewer.session,
        cols: viewer.cols,
        rows: viewer.rows,
      })
    }
    this.tell(viewer.session, { t: 'want', session: viewer.session, since: since ?? 0 })
    if (!this.link) aside('machine recover', this.recover())

    if (viewer.owns && (await this.state()) === 'asleep' && (await this.mayWake()) === null) {
      await this.wake()
    }
  }

  private admitted(socket: WebSocket, viewer: Viewer, size: number): boolean {
    if (!maySocketType(viewer)) {
      this.say(socket, { t: 'refused', error: 'role' })
      return false
    }
    if (size > MOST_INPUT) {
      this.say(socket, { t: 'refused', error: 'large' })
      return false
    }
    const second = Math.floor(Date.now() / 1000)
    const counted = this.rate.get(viewer.who)
    const count = counted?.second === second ? counted.count + 1 : 1
    this.rate.set(viewer.who, { second, count })
    if (count > INPUT_RATE) {
      if (count === INPUT_RATE + 1) this.say(socket, { t: 'refused', error: 'rate' })
      return false
    }
    return true
  }

  private input(socket: WebSocket, viewer: Viewer, data: Uint8Array): void {
    if (!this.admitted(socket, viewer, data.length)) return
    const now = Date.now()

    const wasTyping = now - (this.lastKey.get(viewer.who) ?? 0) < TYPING_FOR
    this.lastKey.set(viewer.who, now)
    if (viewer.owns) this.lastDevice.set(viewer.session, viewer.device)
    this.typedBy(viewer, now)
    this.ensureOpen(viewer)
    this.tell(viewer.session, { t: 'in', session: viewer.session, data })
    if (!this.link) aside('machine recover', this.recover())

    if (now - viewer.seen > SEEN_EVERY) socket.serializeAttachment({ ...viewer, seen: now })
    this.toSession(
      viewer.session,
      { t: 'typed', who: viewer.who, seq: this.ends.get(viewer.session) ?? 0 },
      socket,
    )
    if (!wasTyping) this.people(viewer.session)
  }

  private typedBy(viewer: Viewer, at: number): void {
    const list = (this.typed.get(viewer.session) ?? []).filter((one) => one.who !== viewer.who)
    list.push({ who: viewer.who, at, cols: viewer.cols, rows: viewer.rows })
    this.typed.set(viewer.session, list)
    this.applySize(viewer.session, viewer.who)
  }

  private resized(socket: WebSocket, viewer: Viewer): void {
    socket.serializeAttachment(viewer)
    const list = this.typed.get(viewer.session) ?? []
    const mine = list.find((one) => one.who === viewer.who)
    if (!mine) return
    mine.cols = viewer.cols
    mine.rows = viewer.rows
    this.applySize(viewer.session, viewer.who)
  }

  private applySize(session: string, by: string): void {
    const size = sizeOf(this.typed.get(session) ?? [])
    if (!size) return
    const news = this.news.get(session) ?? {}
    if (news.size?.cols === size.cols && news.size.rows === size.rows) return
    const frame = { t: 'size' as const, ...size, by }
    this.news.set(session, { ...news, size: frame })
    this.tell(session, { t: 'size', session, ...size })
    this.toSession(session, frame)
  }

  private sizeFor(viewer: Viewer): { cols: number; rows: number } {
    return sizeOf(this.typed.get(viewer.session) ?? []) ?? { cols: viewer.cols, rows: viewer.rows }
  }

  private async resume(socket: WebSocket, viewer: Viewer): Promise<void> {
    if (!viewer.owns) {
      this.say(socket, { t: 'refused', error: 'role' })
      return
    }
    const restored = (await this.ctx.storage.get<Record<string, string | null>>(RESTORED)) ?? {}
    const command = resumeOf(restored[viewer.session] ?? null)
    if (!command) return
    this.input(socket, viewer, encoder.encode(command))
    const me = await this.me()
    if (me) await audit(this.env, me.id, 'resume', { who: viewer.who, device: viewer.device })
  }

  private image(
    socket: WebSocket,
    viewer: Viewer,
    frame: Extract<ClientFrame, { t: 'image' }>,
  ): void {
    if (!this.admitted(socket, viewer, frame.part.length)) return
    this.ensureOpen(viewer)
    this.tell(viewer.session, {
      t: 'image',
      session: viewer.session,
      id: frame.id,
      kind: frame.kind,
      data: Uint8Array.from(atob(frame.part), (char) => char.charCodeAt(0)),
      last: frame.last,
    })
    if (!this.link) aside('machine recover', this.recover())
  }

  private imaged(session: string, frame: Extract<ServerFrame, { t: 'image' }>): void {
    for (const socket of this.ctx.getWebSockets(session)) {
      const viewer = viewerOf(socket)
      if (viewer && maySocketType(viewer)) this.say(socket, frame)
    }
  }

  private browse(session: string, url: string): void {
    if (!within(this.opens, OPENS_A_MINUTE)) return
    const owners = this.ctx.getWebSockets(session).flatMap((socket) => {
      const viewer = viewerOf(socket)
      return viewer?.owns && !viewer.parked && socket.readyState === OPEN
        ? [{ socket, viewer }]
        : []
    })
    const device = this.lastDevice.get(session)
    const chosen =
      owners.find((one) => one.viewer.device === device) ??
      owners.sort((a, b) => b.viewer.seen - a.viewer.seen)[0]
    if (chosen) this.say(chosen.socket, { t: 'browse', url })
  }

  private callback(socket: WebSocket, viewer: Viewer, url: string): void {
    if (!viewer.owns) {
      this.say(socket, { t: 'refused', error: 'role' })
      return
    }
    if (!within(this.callbacks, CALLBACKS_A_MINUTE)) {
      this.say(socket, { t: 'refused', error: 'rate' })
      return
    }
    this.tell(viewer.session, { t: 'callback', session: viewer.session, url })
  }

  private called(session: string, frame: Extract<ServerFrame, { t: 'called' }>): void {
    for (const socket of this.ctx.getWebSockets(session)) {
      if (viewerOf(socket)?.owns) this.say(socket, frame)
    }
  }

  private opened = new Set<string>()

  private ensureOpen(viewer: Viewer): void {
    if (!this.link || this.restoring || this.opened.has(viewer.session)) return
    const size = this.sizeFor(viewer)
    if (!maySocketType(viewer)) {
      if (this.news.get(viewer.session)?.ended) return
      this.tell(viewer.session, { t: 'open', session: viewer.session, ...size, watching: true })
      return
    }
    this.opened.add(viewer.session)
    this.tell(viewer.session, { t: 'open', session: viewer.session, ...size })
  }

  private sessions(): Promise<SessionNow[] | null> {
    if (!this.link) return Promise.resolve(null)
    const answered = new Promise<SessionNow[] | null>((resolve) => {
      this.listing.push(resolve)
      setTimeout(() => {
        resolve(null)
      }, LIST_WAIT)
    })
    this.tell('', { t: 'list' })
    return answered
  }

  private tell(_session: string, frame: MachineFrame): void {
    if (!this.link) return
    try {
      this.link.send(linkFrame(frame))
    } catch {
      // A link the runtime gave up on: its close handler deals with that.
    }
  }

  private async attachLink(): Promise<void> {
    const me = await this.me()
    if (!me) throw new Error('a machine that does not know its id')
    const asked = (await this.host()).link(me.id)
    let link: WebSocket
    try {
      link = await capped(asked, LINK_LIMIT, 'link')
    } catch (error) {
      asked.then(
        (late) => {
          try {
            late.close(1000, 'late')
          } catch {
            // Closed already.
          }
        },
        () => undefined,
      )
      throw error
    }
    link.binaryType = 'arraybuffer'
    this.link = link
    this.heard = Date.now()
    this.opened = new Set()
    for (const socket of this.ctx.getWebSockets()) this.next.set(socket, -1)

    link.addEventListener('message', (event: MessageEvent) => {
      if (this.link === link) this.heard = Date.now()
      const data: unknown = event.data
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data instanceof Uint8Array
            ? data
            : null
      const frame = bytes ? nibdFrameOf(bytes) : null
      if (frame) aside('machine nibd', this.fromNibd(frame))
    })
    link.addEventListener('close', () => {
      if (this.link === link) aside('machine recover', this.recover())
    })
    const beat = setInterval(() => {
      this.pulse(link, beat)
    }, PING_EVERY)

    for (const session of (await this.ctx.storage.get<string[]>(ENDING)) ?? []) {
      this.tell(session, { t: 'close', session })
    }
    await this.ctx.storage.delete(ENDING)
    this.reopen()
  }

  private pulse(link: WebSocket, beat: ReturnType<typeof setInterval>): void {
    if (this.link !== link) {
      clearInterval(beat)
      return
    }
    if (Date.now() - this.heard > QUIET_FOR) {
      clearInterval(beat)
      aside('machine recover', this.recover(true))
      return
    }
    this.tell('', { t: 'ping' })
  }

  private reopen(): void {
    if (!this.link || this.restoring) return
    const sessions = new Map<string, Viewer>()
    for (const socket of this.ctx.getWebSockets()) {
      const viewer = viewerOf(socket)
      const held = viewer && sessions.get(viewer.session)
      if (viewer && (!held || (!maySocketType(held) && maySocketType(viewer))))
        sessions.set(viewer.session, viewer)
    }
    for (const viewer of sessions.values()) {
      this.ensureOpen(viewer)
      this.tell(viewer.session, { t: 'want', session: viewer.session, since: 0 })
    }
  }

  async fromNibd(frame: NibdFrame): Promise<void> {
    switch (frame.t) {
      case 'out':
        this.out(frame.session, frame.seq, frame.data)
        return
      case 'screen': {
        const { session, seq, cols, rows, data } = frame
        const screen = {
          seq,
          cols,
          rows,
          data,
          ...(frame.restored ? { restored: frame.restored } : {}),
        }
        if (screen.restored) {
          const restored =
            (await this.ctx.storage.get<Record<string, string | null>>(RESTORED)) ?? {}
          await this.ctx.storage.put(RESTORED, { ...restored, [session]: screen.restored.program })
        }
        for (const socket of this.ctx.getWebSockets(session)) {
          if ((this.next.get(socket) ?? -1) >= screen.seq || viewerOf(socket)?.parked) continue
          this.say(socket, { t: 'screen', ...screen })
          this.next.set(socket, screen.seq)
        }
        this.ends.set(session, Math.max(this.ends.get(session) ?? 0, screen.seq))
        return
      }
      case 'program': {
        const { session, name, title, mark } = frame
        const said = { t: 'program' as const, name, title, mark }
        this.news.set(session, { ...this.news.get(session), program: said })
        this.toSession(session, said)
        return
      }
      case 'ended': {
        const said = { t: 'ended' as const, code: frame.code }
        this.news.set(frame.session, { ...this.news.get(frame.session), ended: said })
        this.opened.delete(frame.session)
        this.toSession(frame.session, said)
        const me = await this.me()
        if (me) await askHub(this.env, me.user, 'terms')
        return
      }
      case 'activity':
        await this.activity(frame.activity)
        return
      case 'saved':
        this.saved?.()
        return
      case 'pong':
        return
      case 'sessions':
        for (const resolve of this.listing.splice(0)) resolve(frame.sessions)
        return
      case 'browse':
        this.browse(frame.session, frame.url)
        return
      case 'called':
        this.called(frame.session, { t: 'called', url: frame.url, status: frame.status })
        return
      case 'image':
        this.imaged(frame.session, { t: 'image', id: frame.id, path: frame.path })
        return
    }
  }

  private out(session: string, seq: number, data: Uint8Array): void {
    const end = seq + data.length
    this.ends.set(session, Math.max(this.ends.get(session) ?? 0, end))
    const news = this.news.get(session)
    if (news?.ended) {
      const { program, size } = news
      this.news.set(session, { ...(program ? { program } : {}), ...(size ? { size } : {}) })
    }

    for (const socket of this.ctx.getWebSockets(session)) {
      const next = this.next.get(socket) ?? -1
      if (next === -1) {
        if (viewerOf(socket)?.parked) continue
        if (seq !== 0) continue
        this.say(socket, { t: 'screen', seq: 0, cols: 80, rows: 24, data: '' })
        this.send(socket, outFrame(0, data))
        this.next.set(socket, end)
        continue
      }
      if (end <= next) continue
      if (seq > next) {
        this.next.set(socket, -1)
        this.tell(session, { t: 'want', session, since: next })
        continue
      }
      this.send(socket, outFrame(next, data.subarray(next - seq)))
      this.next.set(socket, end)
    }
  }

  private async activity(one: Activity): Promise<void> {
    const recent = ((await this.ctx.storage.get<Activity[]>(RECENT)) ?? []).filter(
      (old) => one.at - old.at <= RECENT_FOR,
    )
    recent.push({ ...one, at: Date.now() })
    await this.ctx.storage.put(RECENT, recent, { allowUnconfirmed: true })
    this.pending.cpuS += one.cpu * SMALL.vcpu * 30
    this.pending.egressBytes += one.net
    this.pending.homeBytes = one.homeBytes
    if (one.disk) this.diskIs(one.disk)
  }

  private diskIs(disk: Disk): void {
    this.disk = disk
    const full = diskFull(disk)
    if (full && !this.diskSaid) this.everybody({ t: 'note', note: 'disk' })
    this.diskSaid = full
  }

  private recover(silent = false): Promise<void> {
    this.recovering ??= this.recoverNow(silent).finally(() => {
      this.recovering = null
    })
    return this.recovering
  }

  private async recoverNow(silent: boolean): Promise<void> {
    if (this.sleeping || this.waking) return
    const dead = this.link
    this.link = null
    try {
      dead?.close(4000, 'silent')
    } catch {
      // Gone already.
    }
    if ((await this.state()) !== 'awake') return
    const me = await this.me()
    if (!me) return

    this.everybody({ t: 'link', up: false })
    try {
      await this.attachLink()
      if ((await this.state()) !== 'awake') return
      await audit(this.env, me.id, 'relink')
      this.everybody({ t: 'link', up: true })
      if (silent) await this.quietAgain(me)
      return
    } catch (error) {
      await this.failed(me, 'link', error)
    }
    await this.restart(me)
  }

  private async quietAgain(me: Me): Promise<void> {
    const now = Date.now()
    const again = now - this.relinked < SILENT_AGAIN
    this.relinked = now
    if (!again || !(await this.host()).alwaysOn) return
    this.relinked = 0
    this.tell('', { t: 'restart' })
    await audit(this.env, me.id, 'restart', { detail: 'silent' })
  }

  private async restartNibd(who: string | null): Promise<void> {
    const me = await this.me()
    if (!me || !this.link) return
    this.tell('', { t: 'restart' })
    await audit(this.env, me.id, 'restart', { who, detail: 'stopped' })
  }

  private async restart(me: Me): Promise<void> {
    if ((await this.host()).alwaysOn) {
      await this.waitFor('recover', false)
      return
    }
    const restarting = (async () => {
      await this.setState('starting')
      await this.keep(me, 'awake', { screens: false, backup: false, limit: RESTART_SAVE_LIMIT })
      await audit(this.env, me.id, 'sleep', { detail: 'restart' })
      await this.waken()
    })()
    this.waking = restarting
    try {
      await restarting
    } finally {
      this.waking = null
    }
    if ((await this.ctx.storage.get<MachineState>(STATE)) === 'starting') {
      await this.setState('asleep', 'restart')
    }
  }

  private async waitFor(why: Provision['why'], rebooted: boolean): Promise<void> {
    const now = Date.now()
    const waiting = { since: now, why, rebooted } satisfies Provision
    await this.ctx.storage.put(PROVISION, waiting)
    await this.setState('starting')
    await this.ctx.storage.setAlarm(now + nextLook(waiting, now))
  }

  private async waitForNibd(): Promise<void> {
    const me = await this.me()
    const waiting = await this.ctx.storage.get<Provision>(PROVISION)
    if (!me || !waiting) return
    const now = Date.now()
    try {
      await this.attachLink()
      await this.ctx.storage.delete(PROVISION)
      await this.awoke(me, now, waiting.why === 'boot' ? 'fresh' : 'restart')
      if (waiting.why === 'recover') await audit(this.env, me.id, 'relink')
      return
    } catch {
      // Not yet: said below, once it is late.
    }
    const waited = now - waiting.since
    if (waiting.why === 'recover' && !waiting.rebooted && waited >= REBOOT_AFTER) {
      await this.powerCycle(me)
      return
    }
    const limit = waiting.why === 'boot' ? FIRST_BOOT_LIMIT : REBOOT_LIMIT
    if (waited >= limit) {
      await this.failed(
        me,
        'link',
        new Error(`nibd did not answer in ${String(Math.round(waited / MINUTE))} minutes`),
      )
      await this.ctx.storage.delete(PROVISION)
      await this.setState('asleep', 'restart')
      return
    }
    this.everybody({ t: 'machine', state: 'starting' })
    const after = Date.now()
    await this.ctx.storage.setAlarm(after + nextLook(waiting, after))
  }

  private async powerCycle(me: Me): Promise<void> {
    const host = await this.host()
    try {
      if (!host.reboot) throw new Error('this host cannot reboot a machine')
      await capped(host.reboot(me.id), START_LIMIT, 'reboot')
      await audit(this.env, me.id, 'reboot')
    } catch (error) {
      await this.failed(me, 'start', error)
    }
    await this.waitFor('recover', true)
  }

  private async reboot(): Promise<void> {
    const me = await this.me()
    if (!me || !(await this.host()).alwaysOn) return
    const link = this.link
    this.link = null
    try {
      link?.close(1000, 'reboot')
    } catch {
      // Already closed.
    }
    this.everybody({ t: 'machine', state: 'starting' })
    await this.powerCycle(me)
  }

  private async move(kind: HostKind): Promise<void> {
    const me = await this.me()
    if (!me) return
    this.backupNow = true
    try {
      await this.sleep('stopped')
    } finally {
      this.backupNow = false
    }
    await this.env.DB.prepare('update machines set host = ?2 where id = ?1').bind(me.id, kind).run()
    await this.ctx.storage.put(HOST, kind)
    await this.ctx.storage.delete(PROVISION)
    this.made = null
  }

  private async failed(me: Me, step: Step, error: unknown): Promise<void> {
    note(`machine ${me.id} ${step}`, error, null)
    await audit(this.env, me.id, 'failed', { detail: failureOf(step, error) }).catch(
      (failed: unknown) => {
        note(`machine ${me.id} audit`, failed, null)
      },
    )
  }

  async wake(): Promise<void> {
    const state = await this.state()
    if (state === 'awake' && this.link) return
    this.waking ??= this.waken().finally(() => {
      this.waking = null
    })
    return this.waking
  }

  private async waken(): Promise<void> {
    const me = await this.me()
    if (!me) return
    const refused = await this.mayWake()
    if (refused) {
      this.everybody({ t: 'refused', error: refused })
      return
    }

    await this.setState('starting')
    const row = await this.env.DB.prepare(
      'select server_id, snapshot, snapshot_at, snapshot_image, backup from machines where id = ?',
    )
      .bind(me.id)
      .first<Booted>()

    const now = Date.now()
    const at: { step: Step } = { step: 'start' }
    const host = await this.host()
    let from: Detail
    try {
      from = await this.boot(me, row, now, at)
    } catch (error) {
      this.link = null
      if (error instanceof HostRefused) {
        this.everybody({ t: 'refused', error: error.refusal })
        await this.setState('asleep', error.refusal === 'budget' ? 'budget' : 'restart')
        return
      }
      if (host.alwaysOn && at.step === 'link') {
        await this.waitFor(row?.server_id ? 'recover' : 'boot', false)
        return
      }
      await this.failed(me, at.step, error)
      if (!host.alwaysOn) await host.stop(me.id, 0).catch(() => undefined)
      await this.setState('asleep', 'restart')
      return
    }
    await this.awoke(me, now, from)
  }

  private async awoke(me: Me, now: number, from: Detail): Promise<void> {
    await this.env.DB.prepare(
      `update machines set woke_at = ?2,
         snapshot_at = case when ?3 = 'snapshot' then ?2 else snapshot_at end
       where id = ?1`,
    )
      .bind(me.id, now, from)
      .run()
    await audit(this.env, me.id, 'wake', { detail: from })
    await this.ctx.storage.put(METERED, now)
    await this.ctx.storage.delete(GRACE)
    await this.setState('awake')
    await this.ctx.storage.setAlarm(now + MINUTE)
  }

  private async boot(me: Me, row: Booted | null, now: number, at: { step: Step }): Promise<Detail> {
    const host = await this.host()
    if (host.alwaysOn) {
      await capped(host.start(me.id, IMAGE, await this.bootEnv(me, host)), START_LIMIT, 'start')
      at.step = 'link'
      await this.attachLink()
      return 'running'
    }

    if (await host.running(me.id)) {
      try {
        at.step = 'link'
        await this.attachLink()
        return 'running'
      } catch (error) {
        await this.failed(me, 'link', error)
        await capped(host.stop(me.id, 0), STOP_GRACE, 'stop').catch(() => undefined)
      }
    }

    at.step = 'start'
    const env = await this.bootEnv(me, host)
    let from: Detail = 'fresh'
    const snapshot = row?.snapshot
    const good =
      snapshot &&
      row.snapshot_image === IMAGE &&
      row.snapshot_at !== null &&
      now - row.snapshot_at < SNAPSHOT_KEPT
    if (good) {
      try {
        await capped(host.restore(me.id, { snapshot }), RESTORE_LIMIT, 'snapshot restore')
        await capped(host.start(me.id, IMAGE, env), START_LIMIT, 'start')
        from = 'snapshot'
      } catch (error) {
        await this.failed(me, 'snapshot', error)
      }
    }
    if (from !== 'snapshot') {
      await capped(host.start(me.id, IMAGE, env), START_LIMIT, 'start')
      if (row?.backup) {
        from = 'backup'
        this.restoring = this.restoreHome(me, row.backup)
      }
    }
    at.step = 'link'
    await this.attachLink()
    return from
  }

  private async bootEnv(me: Me, host: MachineHost): Promise<Record<string, string>> {
    const kept = host.alwaysOn ? await this.ctx.storage.get<string>(SECRET) : undefined
    const secret = kept ?? randomToken()
    if (!kept) await this.ctx.storage.put(SECRET, secret)
    const zone = await this.env.DB.prepare(
      `select zone from push_targets where user_id = ? and zone is not null
        order by created_at desc limit 1`,
    )
      .bind(me.user)
      .first<{ zone: string }>()
    return { NIBD_SECRET: secret, TZ: zone?.zone ?? 'UTC' }
  }

  private async restoreHome(me: Me, backup: string): Promise<void> {
    try {
      await capped((await this.host()).restore(me.id, { backup }), RESTORE_LIMIT, 'restore')
      await audit(this.env, me.id, 'restore', { detail: 'backup' })
    } catch (error) {
      await this.failed(me, 'restore', error)
      if (this.link) this.everybody({ t: 'note', note: 'restore' })
    } finally {
      this.restoring = null
      this.reopen()
    }
  }

  private async mayWake(): Promise<Refusal | null> {
    const me = await this.me()
    return me ? await whyNotWake(this.env, me.user, Date.now()) : 'gone'
  }

  async alarm(): Promise<void> {
    const state = await this.state()
    if (state === 'starting' && (await this.ctx.storage.get<Provision>(PROVISION))) {
      await this.waitForNibd()
      return
    }
    if (state !== 'awake') return
    const me = await this.me()
    if (!me) return
    const now = Date.now()

    if (!this.link) {
      await this.recover()
      if ((await this.state()) !== 'awake') return
    }

    await this.meterNow()
    await this.recheck()

    const down = await this.decide(me, now)
    if (down) {
      await this.sleep(down)
      return
    }
    await this.ctx.storage.setAlarm(now + MINUTE)
  }

  private async decide(me: Me, now: number): Promise<DownReason | null> {
    const service = await serviceOf(this.env)
    const row = await this.env.DB.prepare(
      `select u.online as online, m.held as held, m.keep_awake as keep
         from users u left join machines m on m.user_id = u.id where u.id = ?`,
    )
      .bind(me.user)
      .first<{ online: number; held: string | null; keep: number | null }>()
    if (row?.held) return row.held === 'flag' ? 'flag' : 'stopped'

    const on = service.on && row?.online === 1
    if ((await this.host()).alwaysOn) return on ? null : 'off'
    const recent = (await this.ctx.storage.get<Activity[]>(RECENT)) ?? []
    const answer = awake(
      now,
      this.watchers(now),
      recent,
      row?.keep === 1,
      await usedOf(this.env, me.user, now),
      on ? ALLOWANCE : OFF,
      await budgetLeft(this.env, service.ceiling, now),
    )
    if (answer.stay) {
      await this.ctx.storage.delete(GRACE)
      return null
    }
    if (answer.reason !== 'budget') return answer.reason

    const grace = await this.ctx.storage.get<number>(GRACE)
    if (grace === undefined) {
      await this.ctx.storage.put(GRACE, now + BUDGET_GRACE)
      this.everybody({ t: 'machine', state: 'awake', reason: 'budget' })
      return null
    }
    return now >= grace ? 'budget' : null
  }

  private watchers(now: number): Watcher[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      const viewer = viewerOf(socket)
      if (!viewer || socket.readyState !== OPEN) return []
      const seen = Math.max(viewer.seen, this.lastKey.get(viewer.who) ?? 0)
      return [
        { who: viewer.who, device: viewer.device, active: now - seen < ACTIVE_FOR, onScreen: true },
      ]
    })
  }

  async sleep(reason: DownReason): Promise<void> {
    const state = await this.state()
    const me = await this.me()
    if (!me || state === 'asleep' || state === 'stopping') return
    this.sleeping = true
    try {
      await this.sleepFrom(state, me, reason)
    } finally {
      this.sleeping = false
    }
  }

  private async sleepFrom(
    state: MachineState,
    me: NonNullable<Awaited<ReturnType<Machine['me']>>>,
    reason: DownReason,
  ): Promise<void> {
    await this.setState('stopping', reason)
    await this.keep(me, state, { screens: true, backup: true, limit: SAVE_LIMIT })
    await this.env.DB.prepare('update machines set slept_at = ?2 where id = ?1')
      .bind(me.id, Date.now())
      .run()
    await audit(this.env, me.id, 'sleep', { detail: reason })
    await this.ctx.storage.delete(RECENT)
    await this.ctx.storage.deleteAlarm()
    await this.setState('asleep', reason)
  }

  private async keep(
    me: Me,
    state: MachineState,
    how: { screens: boolean; backup: boolean; limit: number },
  ): Promise<void> {
    if (how.screens && this.link) {
      const saved = new Promise<void>((resolve) => {
        this.saved = resolve
        setTimeout(resolve, SAVE_WAIT)
      })
      this.tell('', { t: 'sleep' })
      await saved
      this.saved = null
    }

    const now = Date.now()
    const host = await this.host()
    const keeps = state === 'awake' && !host.alwaysOn
    if (keeps) {
      try {
        const snapshot = await capped(host.snapshot(me.id), how.limit, 'snapshot')
        await this.env.DB.prepare(
          'update machines set snapshot = ?2, snapshot_at = ?3, snapshot_image = ?4 where id = ?1',
        )
          .bind(me.id, snapshot, now, IMAGE)
          .run()
        await audit(this.env, me.id, 'snapshot')
      } catch (error) {
        await this.failed(me, 'snapshot', error)
      }
    }

    const row = await this.env.DB.prepare('select backup_at, backup_key from machines where id = ?')
      .bind(me.id)
      .first<{ backup_at: number | null; backup_key: string | null }>()
    const due = this.backupNow || (row?.backup_at ?? 0) < now - BACKUP_EVERY
    if (how.backup && keeps && due) {
      try {
        const record = await capped(host.backup(me.id, HOME), how.limit, 'backup')
        const key = keyOf(record)
        await this.env.DB.prepare(
          'update machines set backup = ?2, backup_key = ?3, backup_at = ?4 where id = ?1',
        )
          .bind(me.id, record, key, now)
          .run()
        if (row?.backup_key && row.backup_key !== key) await this.env.HOMES?.delete(row.backup_key)
        await audit(this.env, me.id, 'backup')
      } catch (error) {
        await this.failed(me, 'backup', error)
      }
    }

    const link = this.link
    this.link = null
    try {
      link?.close(1000, 'asleep')
    } catch {
      // Already closed.
    }
    try {
      if (!host.alwaysOn) await capped(host.stop(me.id, STOP_GRACE), STOP_GRACE + 15_000, 'stop')
    } catch (error) {
      await this.failed(me, 'stop', error)
    }
    await this.meterNow()
  }

  private async meterNow(): Promise<void> {
    const me = await this.me()
    if (!me) return
    const now = Date.now()
    const from = (await this.ctx.storage.get<number>(METERED)) ?? now
    const host = await this.host()
    const said = await host.usage(me.id, from).catch(() => ({ cpuS: 0, egressBytes: 0 }))
    const used = {
      awakeS: Math.max(0, (now - from) / 1000),
      cpuS: Math.max(said.cpuS, this.pending.cpuS),
      egressBytes: Math.max(said.egressBytes, this.pending.egressBytes),
    }
    const home = this.pending.homeBytes
    this.pending = { cpuS: 0, egressBytes: 0, homeBytes: -1 }
    if (!host.alwaysOn) await meter(this.env, me.user, now, used)
    await this.ctx.storage.put(METERED, now)
    if (this.disk) {
      await this.env.DB.prepare('update machines set disk_used = ?2, disk_total = ?3 where id = ?1')
        .bind(me.id, this.disk.used, this.disk.total)
        .run()
    }
    if (home >= 0) {
      await this.env.DB.prepare('update machines set home_bytes = ?2 where id = ?1')
        .bind(me.id, home)
        .run()
    }
  }

  private async recheck(): Promise<void> {
    const me = await this.me()
    if (!me) return
    const sockets = this.ctx.getWebSockets().flatMap((socket) => {
      const viewer = viewerOf(socket)
      return viewer ? [{ socket, viewer }] : []
    })
    if (!sockets.length) return

    const logins = [
      ...new Set(sockets.flatMap(({ viewer }) => (viewer.login ? [viewer.login] : []))),
    ]
    const live = await stillSignedIn(this.env, logins)
    this.signedOut(logins.filter((one) => !live.has(one)))

    const pairs = new Map<string, { who: string; term: string; guest: boolean }>()
    for (const { viewer } of sockets) {
      pairs.set(`${viewer.who}\n${viewer.term}`, {
        who: viewer.who,
        term: viewer.term,
        guest: viewer.guest,
      })
    }
    const reached = await reachAgain(this.env, me.id, [...pairs.values()])
    const now = new Map(reached.map((one) => [`${one.who}\n${one.term}`, one]))

    for (const { socket, viewer } of sockets) {
      const one = now.get(`${viewer.who}\n${viewer.term}`)
      if (one?.session !== viewer.session) {
        socket.close(4403, 'no longer reaches this terminal')
        continue
      }
      this.reattach(socket, { ...viewer, role: one.role, owns: one.owns, typing: one.typing })
    }

    const held = new Set(sockets.flatMap(({ viewer }) => (viewer.parked ? [viewer.session] : [])))
    for (const session of held) await this.lock.settle(session)
  }

  private reattach(socket: WebSocket, viewer: Viewer): void {
    const before = viewerOf(socket)
    const watches = viewer.parked === true && !drives(viewer)
    socket.serializeAttachment(watches ? { ...viewer, parked: false, lost: false } : viewer)
    if (before && maySocketType(before) !== maySocketType(viewer)) {
      this.say(socket, { t: 'role', type: maySocketType(viewer) })
    }
    if (watches) this.say(socket, { t: 'hold' })
    else if (before && drives(before) && !before.parked && !drives(viewer))
      aside('machine hold', this.lock.settle(viewer.session))
  }

  private retype(term: string, typing: string | null): void {
    const value: Typing = typing === 'writers' ? 'writers' : 'owner'
    for (const socket of this.ctx.getWebSockets()) {
      const viewer = viewerOf(socket)
      if (viewer?.term === term) this.reattach(socket, { ...viewer, typing: value })
    }
  }

  private revoke(who: string, role: string | null, headers: Headers): void {
    const terms = new Set((headers.get('x-nib-terms') ?? '').split(',').filter(Boolean))
    for (const socket of this.ctx.getWebSockets(who)) {
      const viewer = viewerOf(socket)
      if (!viewer || viewer.owns || !terms.has(viewer.term)) continue
      if (role === 'read') this.reattach(socket, { ...viewer, role: 'read' })
      else socket.close(4403, 'no longer reaches this terminal')
    }
  }

  private signedOut(logins: readonly string[]): void {
    for (const login of logins) {
      for (const socket of this.ctx.getWebSockets(loginTag(login))) {
        socket.close(4401, 'signed out')
      }
    }
  }

  private async end(session: string): Promise<void> {
    if (this.link) this.tell(session, { t: 'close', session })
    else {
      const ending = (await this.ctx.storage.get<string[]>(ENDING)) ?? []
      await this.ctx.storage.put(ENDING, [...new Set([...ending, session])])
    }
    this.opened.delete(session)
    await this.lock.drop(session)
    for (const socket of this.ctx.getWebSockets(session)) {
      this.say(socket, { t: 'ended', code: null })
      socket.close(4404, 'this session ended')
    }
  }

  private async erase(id: string | null): Promise<Response> {
    const me = await this.me()
    const machine = me?.id ?? id
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, 'no longer a machine')
    try {
      this.link?.close(1000, 'erased')
    } catch {
      // Already closed.
    }
    this.link = null
    if (machine) {
      const host = await this.host()
      if (!host.alwaysOn) await host.stop(machine, 0).catch(() => undefined)
      try {
        if (host.remove) await host.remove(machine)
        else if (!this.given) await hostOf('hetzner', this.ctx, this.env).remove?.(machine)
      } catch (error) {
        note(`machine ${machine} erase`, error, null)
        return new Response('the server is still there', { status: 503 })
      }
    }
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    return new Response(null, { status: 204 })
  }

  private async me(): Promise<Me | null> {
    return (await this.ctx.storage.get<Me>(ME)) ?? null
  }

  async state(): Promise<MachineState> {
    const kept = (await this.ctx.storage.get<MachineState>(STATE)) ?? 'asleep'
    const orphan =
      (kept === 'stopping' && !this.sleeping) ||
      (kept === 'starting' && !this.waking && !(await this.ctx.storage.get(PROVISION)))
    if (orphan) {
      await this.ctx.storage.put(STATE, 'asleep')
      return 'asleep'
    }
    return kept
  }

  private async down(): Promise<DownReason | null> {
    return (await this.ctx.storage.get<DownReason>(DOWN)) ?? null
  }

  private async setState(state: MachineState, reason?: DownReason): Promise<void> {
    await this.ctx.storage.put(STATE, state)
    if (reason) await this.ctx.storage.put(DOWN, reason)
    else await this.ctx.storage.delete(DOWN)

    const me = await this.me()
    if (!me) return
    await this.env.DB.prepare('update machines set state = ?2 where id = ?1')
      .bind(me.id, state)
      .run()
    this.everybody({ t: 'machine', state, ...(reason ? { reason } : {}) })
    await askHub(this.env, me.user, 'machine', { 'x-nib-state': state })
  }

  private people(session: string, except?: WebSocket): void {
    const now = Date.now()
    const seen = new Set<string>()
    const people = this.ctx.getWebSockets(session).flatMap((socket) => {
      const viewer = viewerOf(socket)
      if (!viewer || socket === except || socket.readyState !== OPEN || viewer.parked) return []
      const key = `${viewer.who}\n${viewer.device}`
      if (seen.has(key)) return []
      seen.add(key)
      const typing = now - (this.lastKey.get(viewer.who) ?? 0) < TYPING_FOR
      return [{ who: viewer.who, device: viewer.device, typing }]
    })
    this.toSession(session, { t: 'people', people }, except)
  }

  private toSession(session: string, frame: ServerFrame, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets(session)) {
      if (socket !== except) this.say(socket, frame)
    }
  }

  private everybody(frame: ServerFrame): void {
    for (const socket of this.ctx.getWebSockets()) this.say(socket, frame)
  }

  private say(socket: WebSocket, frame: ServerFrame): void {
    try {
      socket.send(text(frame))
    } catch {
      // Closing or closed: its close handler deals with that.
    }
  }

  private send(socket: WebSocket, bytes: Uint8Array): void {
    try {
      socket.send(bytes)
    } catch {
      // As above.
    }
  }
}

function nextLook(waiting: Provision, now: number): number {
  if (waiting.why === 'boot') return PROVISION_EVERY
  return Math.min(PROVISION_EVERY, Math.max(FIRST_LOOK, Math.round((now - waiting.since) / 2)))
}

function maySocketType(viewer: Viewer): boolean {
  return mayType(viewer.role, viewer.guest, viewer.owns, viewer.typing)
}

function drives(viewer: Viewer): boolean {
  return viewer.hold === true && maySocketType(viewer)
}

function viewerFrom(headers: Headers): Viewer {
  const role = headers.get('x-nib-role')
  return {
    who: headers.get('x-nib-who') ?? '',
    device: headers.get('x-nib-device') ?? '',
    term: headers.get('x-nib-term') ?? '',
    session: headers.get('x-nib-session') ?? '',
    guest: headers.get('x-nib-guest') === 'yes',
    role: role === 'owner' || role === 'write' || role === 'read' ? role : null,
    owns: headers.get('x-nib-owns') === 'yes',
    typing: headers.get('x-nib-typing') === 'writers' ? 'writers' : 'owner',
    cols: 80,
    rows: 24,
    seen: Date.now(),
    login: headers.get('x-nib-login') ?? '',
    name: unescaped(headers.get('x-nib-device-name') ?? ''),
  }
}

function unescaped(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

function within(counted: { minute: number; count: number }, most: number): boolean {
  const minute = Math.floor(Date.now() / MINUTE)
  if (counted.minute !== minute) {
    counted.minute = minute
    counted.count = 0
  }
  counted.count += 1
  return counted.count <= most
}

function isRefusal(value: string): value is Refusal {
  return REFUSALS.some((one) => one === value)
}

function downOf(value: string | null): DownReason {
  return value === 'flag' || value === 'off' || value === 'budget' || value === 'allowance'
    ? value
    : 'stopped'
}

export function resumeOf(program: string | null): string | null {
  if (program === 'claude') return 'claude --continue\r'
  if (program === 'codex') return 'codex resume --last\r'
  return null
}

function keyOf(record: string): string | null {
  try {
    const parsed = JSON.parse(record) as { key?: unknown }
    return typeof parsed.key === 'string' ? parsed.key : null
  } catch {
    return null
  }
}
