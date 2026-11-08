import { Awareness } from 'y-protocols/awareness'
import {
  awarenessState,
  awarenessUpdate,
  forget,
  isEdit,
  unattended,
  receive,
  syncStep1,
  syncUpdate,
} from '@orden/rooms'
import { fold } from '@orden/rooms/fold'
import {
  ackFrame,
  BEAT,
  BEAT_ANSWER,
  epochFrame,
  frame,
  MOST_UPDATE_BYTES,
  NEW_EPOCH,
  NOW_READS,
  type PushAnswer,
  unframe,
} from '@orden/sync-core'
import * as Y from 'yjs'
import { byteLength, sha256 } from '../crypto'
import { note as noted } from '../failed'
import { pokeSpace } from '../hub/poke'
import { MAX_NOTE_BYTES, noteBeside, noteKey, saveNote, UNREADABLE } from '../notes'
import { OPEN_HEADER, openAnswer, openIn, sweepOpened } from '../opened'
import { fits } from '../storage'
import { revive } from '../sync2/ops'
import { ASK_SIGNINS_EVERY, SIGNED_OUT, stillSignedIn } from '../signins'
import type { Env, Note } from '../types'
import { deviceIn, versionKey } from '../versions'
import { ingested, seedOf, snapshotKey } from './epoch'
import {
  fileOf,
  fill,
  kindOf,
  leavesAPlane,
  neverHeld,
  noteKind,
  readsAs,
  takeInto,
  type Lines,
  linesOf,
  asWritten,
  unixLines,
  unixWords,
  writesOf,
  type RoomKind,
} from './kind'
import { RoomState, TOO_LARGE_IN_A_ROOM } from './state'
import { accessOf } from './access'
import { steadyEnv } from '../steady'

const SETTLE_DELAY = 1_200

const SETTLES_WITHIN = 15_000

const MOST_ANNOUNCED = 32

export interface Held {
  noteId: string
  spaceId: string
  kind: RoomKind
  version?: number
  hash?: string
  epoch?: number
  epochBase?: string
  snapshot?: number
  lines?: Lines
}

interface Attached {
  clients: number[]
  mayWrite: boolean
  who: string
  v2?: boolean
  device?: string
  login?: string
}

export interface Joining {
  writes: boolean
  who: string
  v2?: boolean
  device?: string
  login?: string
  epoch?: number
}

const TOO_LARGE = 1009

function heldIn(value: unknown): Held | null {
  if (typeof value !== 'object' || value === null) return null

  const held = value as Partial<Held>
  if (typeof held.noteId !== 'string' || typeof held.spaceId !== 'string') return null

  return {
    noteId: held.noteId,
    spaceId: held.spaceId,
    kind: kindOf(held.kind),
    ...(typeof held.version === 'number' ? { version: held.version } : {}),
    ...(typeof held.hash === 'string' && held.hash ? { hash: held.hash } : {}),
    ...(typeof held.epoch === 'number' ? { epoch: held.epoch } : {}),
    ...(typeof held.epochBase === 'string' ? { epochBase: held.epochBase } : {}),
    ...(typeof held.snapshot === 'number' ? { snapshot: held.snapshot } : {}),
    ...(held.lines === 'crlf' || held.lines === 'lf' ? { lines: held.lines } : {}),
  }
}

function attachedTo(socket: WebSocket): Partial<Attached> | null {
  const held: unknown = socket.deserializeAttachment()
  return held && typeof held === 'object' ? held : null
}

function announcedBy(socket: WebSocket): number[] {
  const clients = attachedTo(socket)?.clients
  return Array.isArray(clients) ? clients.filter((one) => typeof one === 'number') : []
}

function mayWrite(socket: WebSocket): boolean {
  return attachedTo(socket)?.mayWrite === true
}

function whoOf(socket: WebSocket): string {
  const held = attachedTo(socket)?.who
  return typeof held === 'string' ? held : ''
}

function speaksV2(socket: WebSocket): boolean {
  return attachedTo(socket)?.v2 === true
}

function deviceIdOf(socket: WebSocket): string | undefined {
  const device = attachedTo(socket)?.device
  return typeof device === 'string' && device ? device : undefined
}

function loginOf(socket: WebSocket): string | undefined {
  const login = attachedTo(socket)?.login
  return typeof login === 'string' && login ? login : undefined
}

function attach(socket: WebSocket, change: Partial<Attached>) {
  const device = deviceIdOf(socket)
  const login = loginOf(socket)
  const kept: Attached = {
    clients: announcedBy(socket),
    mayWrite: mayWrite(socket),
    who: whoOf(socket),
    ...(speaksV2(socket) ? { v2: true } : {}),
    ...(device === undefined ? {} : { device }),
    ...(login === undefined ? {} : { login }),
  }
  socket.serializeAttachment({ ...kept, ...change } satisfies Attached)
}

function demote(socket: WebSocket, awareness: Awareness) {
  attach(socket, { mayWrite: false })
  forget(awareness, announcedBy(socket), socket)
  socket.close(NOW_READS, 'only reads this note now')
}

const PUSHED = 'push'

const REMEMBERED_PUSHES = 64

interface Remembered {
  push: string
  seq: number
  sv: Uint8Array
}

function rememberedIn(value: unknown): Remembered[] {
  if (!Array.isArray(value)) return []
  return value.filter((one: unknown): one is Remembered => {
    if (typeof one !== 'object' || one === null) return false
    const { push, seq, sv } = one as Partial<Remembered>
    return typeof push === 'string' && typeof seq === 'number' && sv instanceof Uint8Array
  })
}

interface Pushed {
  push: string
  epoch: number
  seq: number
  base: Uint8Array
  update: Uint8Array
  device?: string
  name?: string
}

function pushedIn(value: unknown): Pushed | null {
  if (typeof value !== 'object' || value === null) return null
  const { push, epoch, seq, base, update, device, name } = value as Record<string, unknown>
  if (typeof push !== 'string' || typeof epoch !== 'number' || typeof seq !== 'number') return null
  if (!(base instanceof Uint8Array) || !(update instanceof Uint8Array)) return null
  return {
    push,
    epoch,
    seq,
    base,
    update,
    ...(typeof device === 'string' ? { device } : {}),
    ...(typeof name === 'string' ? { name } : {}),
  }
}

type Unnamed<T> = T extends unknown ? Omit<T, 'id'> : never
type RoomAnswer = Unnamed<PushAnswer>

export type Ingested = { note: Note } | { conflict: true } | { refused: string }

interface Ingesting {
  text: string
  base?: number
  name?: string
  device?: string
}

function ingestIn(body: Uint8Array): Ingesting | null {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { text, base, name, device } = value as Record<string, unknown>
  if (typeof text !== 'string') return null
  return {
    text,
    ...(typeof base === 'number' ? { base } : {}),
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof device === 'string' ? { device } : {}),
  }
}

const REBUILT = 1012

function epochIn(header: string | null): number | undefined {
  const said = Number(header ?? '')
  return header !== null && Number.isSafeInteger(said) && said >= 0 ? said : undefined
}

function octets(body: Uint8Array): Response {
  return new Response(body, { headers: { 'content-type': 'application/octet-stream' } })
}

interface Placed {
  version: number
  path: string
  epoch: number
  epoch_base: string | null
  hash: string
  deleted: number
}

function deviceOf(socket: WebSocket, awareness: Awareness): string {
  const states = awareness.getStates()

  for (const client of announcedBy(socket)) {
    const said: unknown = states.get(client)
    if (typeof said !== 'object' || said === null) continue

    const who: unknown = (said as { who?: unknown }).who
    if (typeof who !== 'object' || who === null) continue

    const name: unknown = (who as { name?: unknown }).name
    if (typeof name === 'string' && name.trim()) return deviceIn(name)
  }

  return ''
}

export class NoteRoom implements DurableObject {
  private state: RoomState
  private awareness: Awareness
  private opened: Promise<void> | null = null
  private held: Held | null = null
  private signInsAskedAt = 0
  private settleAt: number | null = null
  private settling = ''
  private settlingDevice: string | undefined = undefined

  private readonly env: Env

  constructor(
    private readonly ctx: DurableObjectState,
    env: Env,
  ) {
    this.env = steadyEnv(env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(BEAT, BEAT_ANSWER))
    this.state = new RoomState(ctx.storage)
    this.awareness = new Awareness(this.state.doc)
    this.listen()
  }

  private listen() {
    unattended(this.awareness)

    const awareness = this.awareness
    this.state.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.ctx.waitUntil(this.spread(update, origin))
    })

    awareness.on('update', (changed: AwarenessChange, origin: unknown) => {
      const clients = [...changed.added, ...changed.updated, ...changed.removed]
      if (!clients.length) return

      this.announced(origin, changed)
      this.send(awarenessUpdate(awareness, clients), origin)
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('x-orden-erase')) return await this.erase()

    const openOf = request.headers.get(OPEN_HEADER)
    if (openOf) return openAnswer(this.hasSocketOf(openOf))

    const revoked = request.headers.get('x-orden-revoked')
    if (revoked) return await this.revoke(revoked, request.headers.get('x-orden-role') === 'read')

    const noteId = request.headers.get('x-orden-note')
    const spaceId = request.headers.get('x-orden-space')
    if (!noteId || !spaceId) return new Response('no note', { status: 400 })

    const kind = kindOf(request.headers.get('x-orden-kind'))
    const held: Held = { noteId, spaceId, kind }

    const asked = request.headers.get('x-orden-doc')
    if (asked === 'push' || asked === 'pull' || asked === 'ingest') {
      const body = new Uint8Array(await request.arrayBuffer())
      await this.askSignIns()
      await this.arrive(held)
      await this.caughtUpWithEpoch(epochIn(request.headers.get('x-orden-epoch')))
      if (asked === 'push') return octets(await this.push(body))
      if (asked === 'pull') return octets(await this.pull(body))
      return Response.json(await this.ingest(body))
    }

    const device = request.headers.get('x-orden-device-id')
    const login = request.headers.get('x-orden-login')
    const epoch = epochIn(request.headers.get('x-orden-epoch'))
    const pair = new WebSocketPair()
    await this.enter(pair[1], held, {
      writes: writesOf(request.headers.get('x-orden-write')),
      who: request.headers.get('x-orden-who') ?? '',
      v2: request.headers.get('x-orden-v2') === 'yes',
      ...(device ? { device } : {}),
      ...(login ? { login } : {}),
      ...(epoch === undefined ? {} : { epoch }),
    })

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async enter(
    server: WebSocket,
    held: Held,
    joining: Joining = { writes: true, who: '' },
  ): Promise<void> {
    await this.arrive(held)
    await this.caughtUpWithEpoch(joining.epoch)

    await this.remember(held, joining.who)

    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({
      clients: [],
      mayWrite: joining.writes,
      who: joining.who,
      ...(joining.v2 ? { v2: true } : {}),
      ...(joining.device ? { device: joining.device } : {}),
      ...(joining.login ? { login: joining.login } : {}),
    } satisfies Attached)

    if (!(await this.settleInTime(server, held, joining))) return

    if (joining.who) {
      this.ctx.waitUntil(
        this.sweep(held).catch((error: unknown) => {
          noted(`room ${held.noteId} sweep`, error, null)
        }),
      )
    }

    server.send(syncStep1(this.state.doc))
    const present = awarenessState(this.awareness)
    if (present) server.send(present)
  }

  private async settleInTime(server: WebSocket, held: Held, joining: Joining): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null
    const late = new Promise<'late'>((answer) => {
      timer = setTimeout(() => {
        answer('late')
      }, SETTLES_WITHIN)
    })
    try {
      const settled = await Promise.race([this.settleIn(server, held, joining), late])
      if (settled !== 'late') return settled
      noted(`room ${held.noteId} join`, new Error('the database did not answer a join'), null)
      server.close(1011, 'try again')
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  private async settleIn(server: WebSocket, held: Held, joining: Joining): Promise<boolean> {
    try {
      await this.remember(held, joining.who)
    } catch (error) {
      server.close(1011, 'try again')
      throw error
    }

    return await this.stillLetIn(server, joining)
  }

  private async stillLetIn(server: WebSocket, joining: Joining): Promise<boolean> {
    const login = joining.login
    const noteId = this.held?.noteId
    if (!login || !noteId) return true

    const may = await accessOf(this.env, noteId, [login])
      .then((found) => found.get(login))
      .catch(() => undefined)
    if (may === 'read' && mayWrite(server)) {
      demote(server, this.awareness)
      return false
    }
    if (may !== 'none') return true

    server.close(1008, 'no longer in this space')
    await this.forgetSocket(server)
    return false
  }

  private async arrive(held: Held): Promise<void> {
    await this.crossed(held.kind)
    await this.open(held)
  }

  private async crossed(wanted: RoomKind): Promise<void> {
    const held = this.held ?? heldIn(await this.ctx.storage.get('note'))
    if (!held || held.kind === wanted) return

    await this.open(held)

    if ((await this.carried(held)) !== null && !(await this.settle(true))) {
      throw new Error(`this room still holds the ${held.kind} its file was`)
    }

    if ((held.epoch ?? 0) >= 1) {
      await this.env.DB.prepare(
        'update notes set epoch = epoch + 1, epoch_base = hash where id = ? and epoch = ?',
      )
        .bind(held.noteId, held.epoch)
        .run()
    }

    await this.env.DB.prepare('delete from room_sockets where note_id = ?').bind(held.noteId).run()

    for (const socket of this.ctx.getWebSockets()) {
      forget(this.awareness, announcedBy(socket), socket)
      socket.close(1012, 'this file is another kind of room now')
    }

    await this.ctx.storage.deleteAll()
    this.held = null
    this.opened = null
    this.ctx.abort('the file behind this room is another kind of file now')

    throw new Error(`this room is starting again as a ${wanted} room`)
  }

  private async remember(held: Held, who: string): Promise<void> {
    if (!who) return
    await this.env.DB.prepare(
      `insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, ?)
       on conflict(note_id, who) do update set opened_at = excluded.opened_at`,
    )
      .bind(held.noteId, held.spaceId, who, Date.now())
      .run()
  }

  private async sweep(held: Held): Promise<void> {
    await sweepOpened(this.env, { name: 'room_sockets', key: 'note_id' }, (noteId, them) =>
      noteId === held.noteId
        ? Promise.resolve(this.hasSocketOf(them))
        : roomHolds(this.env, noteId, them),
    )
  }

  private hasSocketOf(who: string): boolean {
    return this.ctx.getWebSockets().some((socket) => whoOf(socket) === who)
  }

  private async forgetSocket(socket: WebSocket): Promise<void> {
    const who = whoOf(socket)
    const held = this.held
    if (!who || !held) return

    const others = this.ctx.getWebSockets().some((one) => one !== socket && whoOf(one) === who)
    if (others) return

    await this.env.DB.prepare('delete from room_sockets where note_id = ? and who = ?')
      .bind(held.noteId, who)
      .run()
  }

  private async askSignIns(): Promise<Set<WebSocket>> {
    const closed = new Set<WebSocket>()
    const now = Date.now()
    if (now - this.signInsAskedAt < ASK_SIGNINS_EVERY) return closed
    this.signInsAskedAt = now

    const sockets = this.ctx.getWebSockets()
    const logins = sockets.flatMap((one) => loginOf(one) ?? [])
    if (!logins.length) return closed

    const live = await stillSignedIn(this.env, logins).catch(() => null)
    if (!live) return closed

    for (const socket of sockets) {
      const login = loginOf(socket)
      if (login === undefined || live.has(login)) continue
      forget(this.awareness, announcedBy(socket), socket)
      socket.close(SIGNED_OUT, 'signed out')
      closed.add(socket)
    }

    const noteOf = (this.held ?? heldIn(await this.ctx.storage.get('note')))?.noteId
    const access = noteOf ? await accessOf(this.env, noteOf, [...live]).catch(() => null) : null
    for (const socket of sockets) {
      const login = loginOf(socket)
      const may = login === undefined || closed.has(socket) ? undefined : access?.get(login)
      if (may === 'none') {
        forget(this.awareness, announcedBy(socket), socket)
        socket.close(1008, 'no longer in this space')
        closed.add(socket)
      } else if (may === 'read' && mayWrite(socket)) {
        demote(socket, this.awareness)
        closed.add(socket)
      }
    }

    const gone = new Set([...closed].map(whoOf))
    for (const socket of sockets) if (!closed.has(socket)) gone.delete(whoOf(socket))
    const noteId = this.held?.noteId
    for (const who of gone) {
      if (!who || !noteId) continue
      await this.env.DB.prepare('delete from room_sockets where note_id = ? and who = ?')
        .bind(noteId, who)
        .run()
    }
    return closed
  }

  private async revoke(who: string, toRead: boolean): Promise<Response> {
    const sockets = this.ctx.getWebSockets()
    if (!sockets.length) return new Response(null, { status: 204 })

    await this.woken()

    const theirs = sockets.filter((socket) => whoOf(socket) === who)
    const noteId = this.held?.noteId
    const logins = theirs.flatMap((one) => loginOf(one) ?? [])
    const access = noteId ? await accessOf(this.env, noteId, logins).catch(() => null) : null
    let kept = false

    for (const socket of theirs) {
      const login = loginOf(socket)
      const may =
        access && login !== undefined ? (access.get(login) ?? 'ended') : toRead ? 'read' : 'none'

      if (may === 'write' || may === 'read') {
        if (may === 'read' && mayWrite(socket)) demote(socket, this.awareness)
        kept = true
        continue
      }

      forget(this.awareness, announcedBy(socket), socket)
      if (may === 'ended') socket.close(SIGNED_OUT, 'signed out')
      else socket.close(1008, 'no longer in this space')
    }

    if (!kept && this.held) {
      await this.env.DB.prepare('delete from room_sockets where note_id = ? and who = ?')
        .bind(this.held.noteId, who)
        .run()
    }

    return new Response(null, { status: 204 })
  }

  private async erase(): Promise<Response> {
    for (const socket of this.ctx.getWebSockets()) {
      forget(this.awareness, announcedBy(socket), socket)
      socket.close(1008, 'no longer in this space')
    }

    this.held = null
    this.opened = null
    this.settleAt = null
    this.startEmpty()
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()

    return new Response(null, { status: 204 })
  }

  private startEmpty() {
    this.state.doc.destroy()
    this.awareness.destroy()
    this.state = new RoomState(this.ctx.storage)
    this.awareness = new Awareness(this.state.doc)
    this.listen()
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    if (typeof message === 'string') return

    const said = new Uint8Array(message)

    if (!mayWrite(socket) && isEdit(said)) return

    await this.woken()

    if ((await this.askSignIns()).has(socket)) return
    if (!mayWrite(socket) && isEdit(said)) return

    if (isEdit(said) && this.state.full()) {
      noted(`room ${this.held?.noteId ?? 'unknown'}`, new Error(TOO_LARGE_IN_A_ROOM), null)
      forget(this.awareness, announcedBy(socket), socket)
      socket.close(TOO_LARGE, TOO_LARGE_IN_A_ROOM)
      return
    }
    const answer = receive(said, this.state.doc, this.awareness, socket, (client) =>
      this.ctx.getWebSockets().every((one) => one === socket || !announcedBy(one).includes(client)),
    )
    if (answer) socket.send(answer)
  }

  async webSocketClose(socket: WebSocket) {
    forget(this.awareness, announcedBy(socket), socket)

    await this.woken()
    await this.forgetSocket(socket)

    if (this.ctx.getWebSockets().length <= 1) {
      if (this.held) await this.unixed(this.held, socket)
      await this.settle()
    }
  }

  async webSocketError(socket: WebSocket) {
    forget(this.awareness, announcedBy(socket), socket)

    await this.woken()
    await this.forgetSocket(socket)
  }

  async alarm() {
    this.settleAt = null
    await this.woken()
    await this.settle()
  }

  private async woken(): Promise<void> {
    if (this.opened) return this.opened

    const held = heldIn(await this.ctx.storage.get('note'))
    if (held) await this.open(held)
  }

  private open(held: Held): Promise<void> {
    if (this.opened) return this.opened

    this.held = held
    const opening = this.ctx.blockConcurrencyWhile(async () => {
      const before = heldIn(await this.ctx.storage.get('note'))
      if (before?.noteId === held.noteId) {
        if (before.version !== undefined) held.version ??= before.version
        if (before.hash !== undefined) held.hash ??= before.hash
        if (before.epoch !== undefined) held.epoch ??= before.epoch
        if (before.epochBase !== undefined) held.epochBase ??= before.epochBase
        if (before.snapshot !== undefined) held.snapshot ??= before.snapshot
        if (before.lines !== undefined) held.lines ??= before.lines
      }

      await this.ctx.storage.put('note', held)

      const loaded = await this.state.load()
      const row = await this.placed(held.noteId)

      if (row && row.epoch >= 1) {
        if (!loaded) await this.startEpoch(held, row, null)
        else if ((held.epoch ?? 0) !== row.epoch) {
          await this.startEpoch(held, row, await this.carried(held))
        }
      } else if (!loaded) {
        const object = await this.env.NOTES.get(noteKey(held.spaceId, held.noteId))
        const file = object ? await object.text() : ''
        await this.state.seed((doc) => fill(held.kind, doc, file))
        if (held.kind === 'words') held.lines = linesOf(file)

        const level = await this.env.DB.prepare('select version from notes where id = ?')
          .bind(held.noteId)
          .first<{ version: number }>()

        if (level) {
          held.version = level.version
          held.hash = await sha256(this.written(held))
        }
        await this.ctx.storage.put('note', held)
      } else {
        await this.unixed(held)
        await this.caughtUp(held)
      }

      const waiting = this.ctx.getWebSockets()
      if (waiting.length) this.send(syncStep1(this.state.doc), null)
    })

    this.opened = opening
    opening.catch(() => {
      if (this.opened !== opening) return

      this.opened = null
      this.held = null
    })

    return opening
  }

  private async caughtUp(held: Held): Promise<void> {
    if (held.version === undefined || held.hash === undefined) return

    const row = await this.env.DB.prepare(
      'select version, path, kind, epoch from notes where id = ? and deleted = 0',
    )
      .bind(held.noteId)
      .first<{ version: number; path: string; kind: string | null; epoch: number | null }>()

    if (!row || row.version === held.version) return
    if (noteKind(row) !== held.kind) return

    const mine = this.written(held)
    if ((await sha256(mine)) !== held.hash) return

    const object = await this.env.NOTES.get(noteKey(held.spaceId, held.noteId))
    const file = object ? await object.text() : ''
    if (!file) return
    if (!readsAs(held.kind, file)) return

    if (file !== mine) {
      if (held.lines === undefined) takeInto(held.kind, this.state.doc, mine, file)
      else {
        takeInto(held.kind, this.state.doc, fileOf(held.kind, this.state.doc), unixLines(file))
        held.lines = linesOf(file)
      }
    }

    held.version = row.version
    held.hash = await sha256(this.written(held))
    await this.ctx.storage.put('note', held)
  }

  private written(held: Held): string {
    const words = fileOf(held.kind, this.state.doc)
    return held.kind === 'words' ? asWritten(held.lines, words) : words
  }

  private async unixed(held: Held, leaving?: WebSocket): Promise<void> {
    if (held.kind !== 'words' || held.lines !== undefined || (held.epoch ?? 0) >= 1) return
    if (this.ctx.getWebSockets().some((socket) => socket !== leaving)) return

    const was = fileOf(held.kind, this.state.doc)
    held.lines = linesOf(was)
    unixWords(this.state.doc, PUSHED)
    if (held.hash !== undefined && held.hash === (await sha256(was))) {
      held.hash = await sha256(this.written(held))
    }
    await this.ctx.storage.put('note', held)
  }

  private async spread(update: Uint8Array, origin: unknown) {
    this.send(syncUpdate(update), origin)

    if (isSocket(origin)) {
      this.settling = deviceOf(origin, this.awareness)
      this.settlingDevice = deviceIdOf(origin)
    }

    await this.state.record(update).catch((wrong: unknown) => {
      noted(`room ${this.held?.noteId ?? 'unknown'}`, wrong, null)
    })
    await this.settleSoon()
  }

  private async settleSoon() {
    if (this.settleAt !== null && this.settleAt > Date.now()) return
    if (this.settleAt === null && (await this.ctx.storage.getAlarm()) !== null) return

    this.settleAt = Date.now() + SETTLE_DELAY
    await this.ctx.storage.setAlarm(this.settleAt)
  }

  private send(message: Uint8Array, except: unknown) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue

      try {
        socket.send(message)
      } catch {
        // A socket the runtime has already given up on. Its close handler takes
        // the carets away; there is nothing to do about it here.
      }
    }
  }

  private announced(origin: unknown, changed: AwarenessChange) {
    if (!isSocket(origin)) return
    if (!changed.added.length && !changed.removed.length) return

    const gone = new Set(changed.removed)
    const clients = [...new Set([...announcedBy(origin), ...changed.added])]
      .filter((one) => !gone.has(one))
      .slice(-MOST_ANNOUNCED)

    attach(origin, { clients })
  }

  private async settle(crossing = false): Promise<boolean> {
    const held = this.held
    if (!held) return false

    await this.state.flush()

    if ((held.epoch ?? 0) >= 1) return await this.settleDocument(held, crossing)

    const file = await this.env.DB.prepare('select * from notes where id = ? and deleted = 0')
      .bind(held.noteId)
      .first<Note>()

    if (!file) return false

    if ((file.epoch ?? 0) >= 1) {
      await this.startEpoch(held, placedOf(file), await this.carried(held))
      await this.settleSoon()
      return false
    }

    if (!crossing && noteKind(file) !== held.kind) {
      noted(
        `room ${held.noteId}`,
        new Error(`the file is a ${noteKind(file)} room now and this one holds ${held.kind}`),
        null,
      )
      return false
    }

    const settled = this.written(held)
    const size = byteLength(settled)
    if (size > MAX_NOTE_BYTES) return false

    if (leavesAPlane(held.kind, this.state.doc)) {
      noted(`room ${held.noteId}`, new Error('this room holds a plane and is read as words'), null)
      return false
    }

    if (!settled && file.size > 0 && neverHeld(this.state.doc)) {
      noted(`room ${held.noteId}`, new Error('this room never held the file it would empty'), null)
      return false
    }

    if (!crossing && held.hash !== undefined && (await sha256(settled)) === held.hash) {
      return file.hash === held.hash
    }

    if (size > file.size) {
      const owner = await this.env.DB.prepare('select user_id from spaces where id = ?')
        .bind(file.space_id)
        .first<{ user_id: string }>()

      if (owner && !(await fits(this.env, owner.user_id, size, file.size))) return false
    }

    if (held.version !== undefined && file.version !== held.version) {
      await this.keptBeside(file, settled, held.kind)
    }

    const saved = await saveNote(
      this.env,
      file,
      settled,
      file.path,
      this.settling,
      this.settlingDevice === undefined ? {} : { versionBy: this.settlingDevice },
    )
    if (!saved) {
      await this.settleSoon()
      return false
    }

    held.version = saved.version
    held.hash = saved.hash
    await this.ctx.storage.put('note', held)

    this.settling = ''
    return true
  }

  private placed(noteId: string): Promise<Placed | null> {
    return this.env.DB.prepare(
      'select version, path, epoch, epoch_base, hash, deleted from notes where id = ?',
    )
      .bind(noteId)
      .first<Placed>()
  }

  private async caughtUpWithEpoch(said: number | undefined): Promise<void> {
    const held = this.held
    if (!held || said === undefined || said <= (held.epoch ?? 0)) return

    const row = await this.placed(held.noteId)
    if (!row || row.epoch <= (held.epoch ?? 0)) return
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.startEpoch(held, row, await this.carried(held))
    })
  }

  private async carried(held: Held): Promise<string | null> {
    if (neverHeld(this.state.doc)) return null
    if (held.hash !== undefined && (await sha256(this.written(held))) === held.hash) return null
    return fileOf(held.kind, this.state.doc)
  }

  private async startEpoch(held: Held, row: Placed, carried: string | null): Promise<void> {
    const object = await this.env.NOTES.get(noteKey(held.spaceId, held.noteId))
    const body = object ? await object.text() : ''
    const bodyHash = await sha256(body)

    let epoch = row.epoch
    let base = row.epoch_base ?? bodyHash
    let seed: string | null = bodyHash === base ? body : null
    if (seed === null) {
      const kept = await this.env.NOTES.get(versionKey(base))
      if (kept) seed = await kept.text()
    }
    if (seed === null) {
      await this.env.DB.prepare(
        'update notes set epoch = ?, epoch_base = ? where id = ? and epoch = ?',
      )
        .bind(epoch + 1, bodyHash, held.noteId, epoch)
        .run()
      const again = await this.placed(held.noteId)
      epoch = again?.epoch ?? epoch + 1
      base = again?.epoch_base ?? bodyHash
      seed = body
    }

    let target = body
    if (carried !== null) {
      const words = held.kind === 'words'
      if (held.hash === undefined || held.hash === bodyHash) target = carried
      else if (words && inside(body, carried)) target = carried
      else if (!words || !inside(carried, body)) await this.besideTheNote(held, carried)
    }

    await this.closeForEpoch(epoch, base)
    await this.state.clear()
    this.startEmpty()

    Y.applyUpdateV2(this.state.doc, seedOf(held.kind, held.noteId, epoch, seed), PUSHED)
    const seeded = fileOf(held.kind, this.state.doc)
    held.epoch = epoch
    held.epochBase = base
    held.version = row.version
    held.hash = await sha256(seeded)
    delete held.snapshot
    delete held.lines

    const update = ingested(held.kind, this.state.doc, held.noteId, seeded, target)
    if (update) Y.applyUpdateV2(this.state.doc, update, PUSHED)

    await this.state.compact()
    await this.ctx.storage.put('note', held)
  }

  private async besideTheNote(held: Held, words: string): Promise<void> {
    const file = await this.env.DB.prepare('select * from notes where id = ?')
      .bind(held.noteId)
      .first<Note>()
    if (file && !(await noteBeside(this.env, file, words, this.settling))) {
      noted(`room ${held.noteId}`, new Error('there was nowhere free to keep it'), null)
    }
  }

  private async closeForEpoch(epoch: number, base: string): Promise<void> {
    const sockets = this.ctx.getWebSockets()
    for (const socket of sockets) {
      forget(this.awareness, announcedBy(socket), socket)
      try {
        if (speaksV2(socket)) {
          socket.send(epochFrame(epoch, base))
          socket.close(NEW_EPOCH, 'this note starts a new document')
        } else {
          socket.close(REBUILT, 'this note starts a new document')
        }
      } catch {
        // A socket the runtime already gave up on is closed either way.
      }
    }

    if (sockets.length && this.held) {
      await this.env.DB.prepare('delete from room_sockets where note_id = ?')
        .bind(this.held.noteId)
        .run()
    }
  }

  private async durable(): Promise<{
    bytes: Uint8Array
    seq: number
    sv: Uint8Array
    at: number
  }> {
    await this.state.flushAll()
    return {
      bytes: Y.encodeStateAsUpdateV2(this.state.doc),
      seq: this.state.seq,
      sv: Y.encodeStateVector(this.state.doc),
      at: this.state.changedAt,
    }
  }

  private async settleDocument(held: Held, crossing: boolean): Promise<boolean> {
    let file = await this.env.DB.prepare('select * from notes where id = ?')
      .bind(held.noteId)
      .first<Note>()
    if (!file) return false

    if ((file.epoch ?? 0) > (held.epoch ?? 0)) {
      await this.startEpoch(held, placedOf(file), await this.carried(held))
      await this.settleSoon()
      return false
    }

    if (!crossing && noteKind(file) !== held.kind) {
      noted(`room ${held.noteId}`, new Error(`the file is a ${noteKind(file)} room now`), null)
      return false
    }
    const settled = fileOf(held.kind, this.state.doc)
    const size = byteLength(settled)
    if (size > MAX_NOTE_BYTES) return false
    if (leavesAPlane(held.kind, this.state.doc)) {
      noted(`room ${held.noteId}`, new Error('this room holds a plane and is read as words'), null)
      return false
    }
    if (!settled && file.size > 0 && neverHeld(this.state.doc)) {
      noted(`room ${held.noteId}`, new Error('this room never held the file it would empty'), null)
      return false
    }

    if (crossing || (await sha256(settled)) !== held.hash) {
      if (file.deleted) {
        await revive(this.env, held.spaceId, this.settlingDevice, held.noteId, 'stays deleted')
        file = await this.env.DB.prepare('select * from notes where id = ? and deleted = 0')
          .bind(held.noteId)
          .first<Note>()
        if (!file) return false
      }

      if (size > file.size) {
        const owner = await this.env.DB.prepare('select user_id from spaces where id = ?')
          .bind(file.space_id)
          .first<{ user_id: string }>()
        if (owner && !(await fits(this.env, owner.user_id, size, file.size))) return false
      }

      const saved = await saveNote(this.env, file, settled, file.path, this.settling, {
        epoch: held.epoch ?? 0,
        ...(this.settlingDevice === undefined ? {} : { docBy: this.settlingDevice }),
      })
      if (!saved) {
        await this.settleSoon()
        return false
      }

      held.version = saved.version
      held.hash = saved.hash
      if (saved !== file) {
        await pokeSpace(this.env, this.ctx, held.spaceId, saved.seq, this.settlingDevice)
      }
    }

    const durable = await this.durable()
    if (held.snapshot !== durable.seq) {
      await this.env.NOTES.put(snapshotKey(held.noteId), durable.bytes, {
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: {
          seq: String(durable.seq),
          epoch: String(held.epoch ?? 0),
          epochBase: held.epochBase ?? '',
          at: String(durable.at),
        },
      })
      held.snapshot = durable.seq
    }
    await this.ctx.storage.put('note', held)

    const ack = ackFrame(durable.seq, durable.sv)
    for (const socket of this.ctx.getWebSockets()) {
      if (!speaksV2(socket)) continue
      try {
        socket.send(ack)
      } catch {
        // Its close handler takes care of it.
      }
    }

    this.settling = ''
    this.settlingDevice = undefined
    return true
  }

  private async push(body: Uint8Array): Promise<Uint8Array> {
    const pushed = pushedIn(unframe(body))
    const held = this.held
    if (!pushed || !held) return frame({ refused: 'gone' } satisfies RoomAnswer)
    if (pushed.epoch !== (held.epoch ?? 0)) {
      return frame({ epoch: held.epoch ?? 0 } satisfies RoomAnswer)
    }

    const remembered = rememberedIn(await this.ctx.storage.get('pushes'))
    const before = remembered.find((one) => one.push === pushed.push)
    if (before) return frame({ ok: true, seq: before.seq, sv: before.sv } satisfies RoomAnswer)

    if (pushed.update.length > MOST_UPDATE_BYTES || this.state.full()) {
      return frame({ refused: 'large' } satisfies RoomAnswer)
    }

    if (pushed.seq !== this.state.seq) {
      await this.state.flushAll()
      try {
        return frame({
          moved: Y.encodeStateAsUpdateV2(this.state.doc, pushed.base),
          seq: this.state.seq,
          sv: Y.encodeStateVector(this.state.doc),
          at: this.state.changedAt,
        } satisfies RoomAnswer)
      } catch {
        return frame({ refused: 'gone' } satisfies RoomAnswer)
      }
    }

    this.settling = deviceIn(pushed.name)
    this.settlingDevice = pushed.device
    try {
      Y.applyUpdateV2(this.state.doc, pushed.update, PUSHED)
    } catch {
      return frame({ refused: 'gone' } satisfies RoomAnswer)
    }

    const seq = this.state.seq
    const sv = Y.encodeStateVector(this.state.doc)
    await this.state.flushAll()
    await this.ctx.storage.put(
      'pushes',
      [...remembered, { push: pushed.push, seq, sv }].slice(-REMEMBERED_PUSHES),
    )
    await this.settleSoon()

    return frame({ ok: true, seq, sv } satisfies RoomAnswer)
  }

  private async pull(body: Uint8Array): Promise<Uint8Array> {
    const asked: unknown = unframe(body)
    const sv = (asked as { sv?: unknown } | null)?.sv
    const held = this.held
    if (!(sv instanceof Uint8Array) || !held) return frame({ refused: 'gone' })

    await this.state.flushAll()
    try {
      return frame({
        update: Y.encodeStateAsUpdateV2(this.state.doc, sv),
        seq: this.state.seq,
        epoch: held.epoch ?? 0,
        epochBase: held.epochBase ?? '',
      })
    } catch {
      return frame({ refused: 'gone' })
    }
  }

  private async ingest(body: Uint8Array): Promise<Ingested> {
    const asked = ingestIn(body)
    const held = this.held
    if (!asked || !held || (held.epoch ?? 0) < 1) return { refused: 'gone' }

    const unsettled = (await sha256(fileOf(held.kind, this.state.doc))) !== held.hash
    const settled = !unsettled || (await this.settle())

    const level = held.hash
    const row = await this.env.DB.prepare('select * from notes where id = ?')
      .bind(held.noteId)
      .first<Note>()
    if (!row) return { refused: 'gone' }
    if (asked.base !== undefined && row.version !== asked.base) return { conflict: true }
    if (!readsAs(held.kind, asked.text)) return { refused: UNREADABLE }

    const current = fileOf(held.kind, this.state.doc)
    if (asked.base !== undefined && asked.text !== current) {
      if (!settled) return { refused: 'unsaved' }
      if (
        (await sha256(current)) !== level ||
        held.hash !== level ||
        fileOf(held.kind, this.state.doc) !== current
      ) {
        return { conflict: true }
      }
    }
    const update = ingested(held.kind, this.state.doc, held.noteId, current, asked.text)
    if (!update) return { note: row }

    this.settling = deviceIn(asked.name)
    this.settlingDevice = asked.device
    Y.applyUpdateV2(this.state.doc, update, PUSHED)
    await this.state.flushAll()
    if (!(await this.settle())) return { refused: 'unsaved' }

    const after = await this.env.DB.prepare('select * from notes where id = ?')
      .bind(held.noteId)
      .first<Note>()
    return after ? { note: after } : { refused: 'gone' }
  }

  private async keptBeside(file: Note, settling: string, kind: RoomKind) {
    try {
      const object = await this.env.NOTES.get(noteKey(file.space_id, file.id))
      const wrote = object ? await object.text() : ''
      if (!wrote || wrote === settling) return

      if (kind === 'words' && inside(wrote, settling)) return

      if (!(await noteBeside(this.env, file, wrote))) {
        throw new Error('there was nowhere free to keep it')
      }
    } catch (wrong) {
      noted(`room ${file.id}`, wrong instanceof Error ? wrong : new Error(String(wrong)), null)
    }
  }
}

function inside(from: string, to: string): boolean {
  const change = fold(from, to)
  return !change || change.from === change.to
}

function placedOf(note: Note): Placed {
  return {
    version: note.version,
    path: note.path,
    epoch: note.epoch ?? 0,
    epoch_base: note.epoch_base ?? null,
    hash: note.hash,
    deleted: note.deleted,
  }
}

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

function isSocket(value: unknown): value is WebSocket {
  return typeof value === 'object' && value !== null && 'serializeAttachment' in value
}

async function roomHolds(env: Env, noteId: string, who: string): Promise<boolean | null> {
  const namespace = env.ROOMS
  if (!namespace) return null
  try {
    const room = namespace.get(namespace.idFromName(noteId))
    return await openIn(
      await room.fetch(
        new Request(`https://rooms.invalid/${noteId}`, { headers: { [OPEN_HEADER]: who } }),
      ),
    )
  } catch {
    return null
  }
}
