import type { Event, Logged, Message, Post, Who } from '@orden/chats'
import { MOST_BEHIND, MOST_PAGE, RECEIPTS_UP_TO, TYPING_EVERY } from '@orden/chats/limits'
import { clientFrameOf, isWho, type Refusal, type ServerFrame } from '@orden/chats/wire'
import { BEAT, BEAT_ANSWER } from '@orden/sync-core/wire'
import { places } from '../bound'
import { OPEN_HEADER, openAnswer, openIn, sweepOpened } from '../opened'
import { note } from '../failed'
import { askHub } from '../hub/reach'
import { ASK_SIGNINS_EVERY, SIGNED_OUT, stillSignedIn } from '../signins'
import type { Env } from '../types'
import { noteUnusedBy } from '../unused'
import {
  admit,
  type Asker,
  type Effects,
  type EventRow,
  INVALID,
  loggedOf,
  metaOf,
  place,
  placedEvent,
  readMeta,
  ROLE,
  setMeta,
} from './placing'
import { askChat } from './ask'
import { hubIdOf, reachAs, reachByToken, reaching } from './reach'
import { SCHEMA } from './schema'
import { steadyEnv } from '../steady'

export type ChatAsk =
  | 'join'
  | 'send'
  | 'events'
  | 'state'
  | 'message'
  | 'search'
  | 'read'
  | 'scheduled'
  | 'revoke'
  | 'erase'
  | 'profile'
  | 'open'
  | 'held-files'

export type Person = Asker & { id: string; guest: boolean }

interface Attached extends Person {
  login?: string
  hello: boolean
  typedAt: number
}

export type Answer = Extract<ServerFrame, { t: 'placed' } | { t: 'refused' }>

const MOST_MESSAGES = 1000
const MOST_PAGE_BYTES = 4 * 1024 * 1024

const MOST_CANDIDATES = 1000

const FLUSH_EVERY = 1000
const POKE_EVERY = 2000

const RETRY_FIRST = 30_000
const RETRY_MOST = 3_600_000

const NAMES_FILE = `select 1 from messages m
  where m.deleted = 0
    and (json_extract(m.json, '$.preview.picture') = ?1
         or exists (select 1 from json_each(m.json, '$.files') f
                     where json_extract(f.value, '$.hash') = ?1
                        or json_extract(f.value, '$.preview') = ?1))
  limit 1`

const REACHERS_FOR = 60_000

function filesOfHeld(post: Post): string[] {
  return [
    ...(post.files ?? []).flatMap((file) =>
      file.preview ? [file.hash, file.preview] : [file.hash],
    ),
    ...(post.preview?.picture ? [post.preview.picture] : []),
  ]
}

function attachedTo(socket: WebSocket): Attached | null {
  const held: unknown = socket.deserializeAttachment()
  if (typeof held !== 'object' || held === null) return null
  const one = held as Partial<Attached>
  if (!isWho(one.who) || typeof one.id !== 'string') return null
  return {
    who: one.who,
    id: one.id,
    guest: one.guest === true,
    role: one.role === 'owner' || one.role === 'write' ? one.role : 'read',
    ...(typeof one.device === 'string' && one.device ? { device: one.device } : {}),
    ...(typeof one.login === 'string' && one.login ? { login: one.login } : {}),
    hello: one.hello === true,
    typedAt: typeof one.typedAt === 'number' ? one.typedAt : 0,
  }
}

function attach(socket: WebSocket, attached: Attached): void {
  socket.serializeAttachment(attached)
}

function say(socket: WebSocket, frame: ServerFrame): void {
  try {
    socket.send(JSON.stringify(frame))
  } catch {
    // Closing or closed.
  }
}

function wholeIn(value: string | null): number | null {
  if (value === null || !/^\d{1,16}$/.test(value)) return null
  return Number(value)
}

export class ChatLog implements DurableObject {
  private ready = false
  private signInsAskedAt = 0
  private reachers: { at: number; list: { id: string; guest: boolean }[] } | null = null

  private readonly env: Env

  constructor(
    private readonly ctx: DurableObjectState,
    env: Env,
  ) {
    this.env = steadyEnv(env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(BEAT, BEAT_ANSWER))
  }

  private get sql(): SqlStorage {
    const sql = this.ctx.storage.sql
    if (!this.ready) {
      sql.exec(SCHEMA)
      this.ready = true
    }
    return sql
  }

  async fetch(request: Request): Promise<Response> {
    const headers = request.headers
    const ask = (headers.get('x-nib-chat-ask') ?? '') as ChatAsk

    if (ask === 'erase') return await this.erase()
    if (ask === 'open') return openAnswer(this.hasSocketOf(headers.get(OPEN_HEADER) ?? ''))
    if (ask === 'revoke') {
      return await this.revoke(headers.get('x-nib-revoked') ?? '', headers.get('x-nib-role'))
    }
    if (ask === 'held-files') {
      return Response.json({ hashes: this.heldFilesOf(headers.get('x-nib-held-by') ?? '') })
    }
    await this.askSignIns()
    if (ask === 'profile') {
      const who = headers.get('x-nib-profile')
      if (isWho(who)) this.everyone({ t: 'profile', who })
      return new Response(null, { status: 204 })
    }

    this.remember(headers.get('x-nib-chat'), headers.get('x-nib-space'))
    const query = new URL(request.url).searchParams
    if (ask === 'events') return Response.json(this.eventsPage(query))
    if (ask === 'state') return Response.json(this.statePage(query))
    if (ask === 'message') return Response.json({ message: this.messageById(query.get('id')) })
    if (ask === 'search') return Response.json({ messages: this.candidates(await request.json()) })

    const person = personOf(headers)
    if (!person) return new Response('nobody', { status: 400 })
    switch (ask) {
      case 'join': {
        const pair = new WebSocketPair()
        await this.enter(pair[1], person, headers.get('x-nib-login') ?? undefined)
        return new Response(null, { status: 101, webSocket: pair[0] })
      }
      case 'send': {
        const { events } = await request.json<{ events: Event[] }>()
        const results = []
        for (const event of events) results.push(resultOf(await this.take(person, event, null)))
        return Response.json({ results })
      }
      case 'read': {
        const body = await request.json<{ seq: number; back?: boolean }>()
        await this.read(person.who, body.seq, body.back === true, null)
        return Response.json({ seq: this.readPlace(person.who) })
      }
      case 'scheduled':
        return Response.json({ scheduled: this.scheduledOf(person.who) })
      default:
        return new Response('not something a chat does', { status: 400 })
    }
  }

  private remember(chat: string | null, space: string | null): void {
    if (chat && readMeta(this.sql, 'chat') !== chat) setMeta(this.sql, 'chat', chat)
    if (space && readMeta(this.sql, 'space') !== space) setMeta(this.sql, 'space', space)
  }

  async enter(server: WebSocket, person: Person, login?: string): Promise<void> {
    await this.writeSocketRow(person.id)

    this.ctx.acceptWebSocket(server, [person.who])
    attach(server, { ...person, ...(login ? { login } : {}), hello: false, typedAt: 0 })

    try {
      await this.writeSocketRow(person.id)
    } catch (error) {
      server.close(1011, 'try again')
      throw error
    }

    this.ctx.waitUntil(
      this.sweep().catch((error: unknown) => {
        note(`chat ${this.chatId()} sweep`, error, null)
      }),
    )
    this.sayHere()
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== 'string') return
    if ((await this.askSignIns()).has(socket)) return
    const me = attachedTo(socket)
    if (!me) return
    const frame = clientFrameOf(message)
    if (!frame) {
      say(socket, { t: 'refused', id: null, error: INVALID })
      return
    }

    switch (frame.t) {
      case 'hello':
        await this.hello(socket, me, frame.since ?? 0)
        break
      case 'send':
        say(socket, await this.take(me, frame.event, socket))
        break
      case 'typing':
        this.typing(socket, me, frame.parent)
        break
      case 'read':
        await this.read(me.who, frame.seq, false, socket)
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
    const me = attachedTo(socket)
    if (!me) return
    const others = this.ctx.getWebSockets(me.who).some((one) => one !== socket)
    if (!others) await this.forgetSocketRow(me.id)
    this.sayHere(socket)
  }

  private async hello(socket: WebSocket, me: Attached, since: number): Promise<void> {
    attach(socket, { ...me, hello: true })
    await this.reachersNow().catch(() => [])

    const head = this.head()
    if (since < head && head - since > MOST_BEHIND) {
      say(socket, { t: 'behind', seq: head })
    } else {
      let after = since
      while (after < head) {
        const rows = this.sql
          .exec<EventRow>(
            'select * from events where seq > ? order by seq limit ?',
            after,
            MOST_PAGE,
          )
          .toArray()
        if (!rows.length) break
        say(socket, { t: 'events', events: rows.map(loggedOf) })
        after = rows[rows.length - 1]?.seq ?? head
      }
    }

    say(socket, { t: 'here', who: this.here() })
    if (this.showsReceipts()) {
      for (const place of this.readPlaces(me.who)) say(socket, { t: 'read', ...place })
    }
  }

  private typing(socket: WebSocket, me: Attached, parent: string | undefined): void {
    if (me.role === 'read' || (me.role === 'write' && metaOf(this.sql).posting === 'owner')) return
    const now = Date.now()
    if (now - me.typedAt < TYPING_EVERY) return
    attach(socket, { ...me, typedAt: now })

    const frame: ServerFrame = { t: 'typing', who: me.who, ...(parent ? { parent } : {}) }
    for (const other of this.ctx.getWebSockets()) {
      const them = attachedTo(other)
      if (other !== socket && them?.hello && them.who !== me.who) say(other, frame)
    }
  }

  private here(leaving?: WebSocket): Who[] {
    const who = new Set<Who>()
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === leaving) continue
      const one = attachedTo(socket)
      if (one) who.add(one.who)
    }
    return [...who]
  }

  private sayHere(leaving?: WebSocket): void {
    const frame: ServerFrame = { t: 'here', who: this.here(leaving) }
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== leaving && attachedTo(socket)?.hello) say(socket, frame)
    }
  }

  private everyone(frame: ServerFrame, but?: WebSocket | null): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== but && attachedTo(socket)?.hello) say(socket, frame)
    }
  }

  async take(person: Person, event: Event, from: WebSocket | null): Promise<Answer> {
    const sql = this.sql
    const at = Date.now()

    const had = placedEvent(sql, event.id)
    if (had) return { t: 'placed', id: had.id, seq: had.seq, at: had.at }
    const held = this.heldAnswer(event.id)
    if (held) return held

    if (event.kind === 'delete' && (await this.unschedule(person.who, event.target))) {
      return { t: 'placed', id: event.id, seq: 0, at }
    }

    const refused = admit(sql, event, person, at)
    if (refused) return { t: 'refused', id: event.id, error: refused }
    if (!(await this.holds(person, event))) return { t: 'refused', id: event.id, error: INVALID }

    if (event.kind === 'schedule' && event.sendAt > at + FLUSH_EVERY) {
      await this.schedule(person, event)
      return { t: 'placed', id: event.id, seq: 0, at: event.sendAt }
    }
    return await this.placeNow(person, event.kind === 'schedule' ? event.post : event, at, from)
  }

  private async placeNow(
    person: Person,
    event: Exclude<Event, { kind: 'schedule' }>,
    at: number,
    from: WebSocket | null,
  ): Promise<Answer> {
    const mentions = event.kind === 'post' ? (event.mentions ?? []) : []
    if (mentions.includes('here') || mentions.includes('everyone')) {
      await this.reachersNow().catch((error: unknown) => {
        note(`chat ${this.chatId()} reachers`, error, null)
      })
    }

    const { logged, effects, called } = this.ctx.storage.transactionSync(() => {
      const placed = place(this.sql, event, person, at)
      return { ...placed, called: this.noted(placed.logged, placed.effects) }
    })
    this.everyone({ t: 'events', events: [logged] }, from)
    await this.after(logged, effects, called)
    return { t: 'placed', id: logged.id, seq: logged.seq, at: logged.at }
  }

  private noted(logged: Logged, effects: Effects): Who[] {
    this.flushSoon()
    if (logged.kind !== 'post') return []
    const sql = this.sql
    const called = new Set<Who>()
    for (const one of effects.called) {
      if (one === 'here' || one === 'everyone') {
        for (const person of this.reachers?.list ?? []) {
          called.add(person.guest ? `guest:${person.id}` : `user:${person.id}`)
        }
      } else called.add(one)
    }
    if (effects.answered) called.add(effects.answered)
    called.delete(logged.author)
    for (const who of called) {
      sql.exec('insert or ignore into mentioned (who, seq) values (?, ?)', who, logged.seq)
      sql.exec(
        'insert into members (who, dirty) values (?, 1) on conflict(who) do update set dirty = 1',
        who,
      )
    }
    sql.exec(
      `insert into members (who, read_seq, dirty) values (?, ?, 1)
       on conflict(who) do update set read_seq = max(read_seq, excluded.read_seq), dirty = 1`,
      logged.author,
      logged.seq,
    )
    return [...called]
  }

  private async after(logged: Logged, effects: Effects, called: readonly Who[]): Promise<void> {
    try {
      await this.keepFiles(effects, logged.at)
      await this.freeFiles(effects)
    } catch (error) {
      note(`chat ${this.chatId()} files`, error, null)
    }
    if (logged.kind === 'post') await this.poke(logged, called)
    await this.plan()
  }

  private async holds(person: Person, event: Event): Promise<boolean> {
    const post = event.kind === 'schedule' ? event.post : event
    if (post.kind !== 'post' && post.kind !== 'edit') return true
    const hashes = new Set<string>()
    for (const file of post.files ?? []) {
      hashes.add(file.hash)
      if (file.preview) hashes.add(file.preview)
    }
    if (post.kind === 'post' && post.preview?.picture) hashes.add(post.preview.picture)
    if (!hashes.size) return true
    if (person.guest) return false
    const { results } = await this.env.DB.prepare(
      `select distinct hash from blobs where user_id = ? and hash in (${places(hashes.size)})`,
    )
      .bind(person.id, ...hashes)
      .all<{ hash: string }>()
    return results.length === hashes.size
  }

  private heldFilesOf(who: string): string[] {
    const rows = this.sql.exec<{ post: string }>('select post from scheduled where author = ?', who)
    return rows.toArray().flatMap((row) => filesOfHeld(JSON.parse(row.post) as Post))
  }

  private async heldNoMore(who: Who, hashes: readonly string[]): Promise<void> {
    if (!hashes.length || who.startsWith('guest:')) return
    await noteUnusedBy(this.env, hubIdOf(who), hashes, Date.now())
      .run()
      .catch((error: unknown) => {
        note(`chat ${this.chatId()} held`, error, null)
      })
  }

  private heldAnswer(id: string): Answer | null {
    const row = this.sql
      .exec<{ send_at: number }>('select send_at from scheduled where id = ?', id)
      .toArray()[0]
    return row ? { t: 'placed', id, seq: 0, at: row.send_at } : null
  }

  private async schedule(person: Person, event: Extract<Event, { kind: 'schedule' }>) {
    const sql = this.sql
    const before = sql
      .exec<{ post: string }>(
        'select post from scheduled where message = ? and author = ?',
        event.post.message,
        person.who,
      )
      .toArray()
      .flatMap((row) => filesOfHeld(JSON.parse(row.post) as Post))
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        `delete from scheduled_tries where id in (
           select id from scheduled where message = ? and author = ?
         )`,
        event.post.message,
        person.who,
      )
      sql.exec(
        'delete from scheduled where message = ? and author = ?',
        event.post.message,
        person.who,
      )
      sql.exec(
        `insert into scheduled (id, message, author, device, send_at, post)
         values (?, ?, ?, ?, ?, ?)`,
        event.id,
        event.post.message,
        person.who,
        person.device ?? null,
        event.sendAt,
        JSON.stringify(event.post),
      )
    })
    const still = new Set(filesOfHeld(event.post))
    await this.heldNoMore(
      person.who,
      before.filter((hash) => !still.has(hash)),
    )
    await this.plan()
  }

  private async unschedule(who: Who, message: string): Promise<boolean> {
    const row = this.sql
      .exec<{ id: string; post: string }>(
        'select id, post from scheduled where message = ? and author = ?',
        message,
        who,
      )
      .toArray()[0]
    if (row) {
      this.sql.exec('delete from scheduled where id = ?', row.id)
      this.sql.exec('delete from scheduled_tries where id = ?', row.id)
      await this.heldNoMore(who, filesOfHeld(JSON.parse(row.post) as Post))
    }
    return row !== undefined
  }

  private scheduledOf(who: Who) {
    return this.sql
      .exec<{ id: string; send_at: number; post: string; refused: string | null }>(
        'select id, send_at, post, refused from scheduled where author = ? order by send_at',
        who,
      )
      .toArray()
      .map((one) => ({
        id: one.id,
        sendAt: one.send_at,
        post: JSON.parse(one.post) as Post,
        ...(one.refused ? { refused: one.refused as Refusal } : {}),
      }))
  }

  private async placeDue(now: number): Promise<void> {
    const chat = this.chatId()
    if (!chat) return
    const due = this.sql
      .exec<{ id: string; author: string; device: string | null; post: string }>(
        `select s.id, s.author, s.device, s.post from scheduled s
          left join scheduled_tries t on t.id = s.id
          where s.send_at <= ? and s.refused is null and coalesce(t.next_at, 0) <= ?
          order by s.send_at limit 50`,
        now,
        now,
      )
      .toArray()

    for (const one of due) {
      try {
        await this.placeOne(chat, one, now)
      } catch (error) {
        note(`chat ${chat} scheduled`, error, null)
        const tries =
          (this.sql
            .exec<{ tries: number }>('select tries from scheduled_tries where id = ?', one.id)
            .toArray()[0]?.tries ?? 0) + 1
        this.sql.exec(
          `insert into scheduled_tries (id, tries, next_at) values (?, ?, ?)
           on conflict (id) do update set tries = excluded.tries, next_at = excluded.next_at`,
          one.id,
          tries,
          now + Math.min(RETRY_FIRST * 2 ** (tries - 1), RETRY_MOST),
        )
      }
    }
  }

  private async placeOne(
    chat: string,
    one: { id: string; author: string; device: string | null; post: string },
    now: number,
  ): Promise<void> {
    const who = one.author as Who
    const id = hubIdOf(who)
    const guest = who.startsWith('guest:')
    const reached = await reachAs(this.env, { id, guest }, chat)
    const post = JSON.parse(one.post) as Post
    const answer = reached
      ? await this.take(
          { who, id, guest, role: reached.role, ...(one.device ? { device: one.device } : {}) },
          post,
          null,
        )
      : ({ t: 'refused', id: post.id, error: ROLE } as const)
    this.sql.exec('delete from scheduled where id = ?', one.id)
    this.sql.exec('delete from scheduled_tries where id = ?', one.id)
    if (answer.t === 'refused') {
      this.sql.exec(
        `insert into scheduled (id, message, author, device, send_at, post, refused)
         values (?, ?, ?, ?, ?, ?, ?)`,
        one.id,
        post.message,
        who,
        one.device,
        now,
        one.post,
        answer.error,
      )
    }
  }

  private head(): number {
    return (
      this.sql.exec<{ seq: number | null }>('select max(seq) as seq from events').one().seq ?? 0
    )
  }

  private readPlace(who: Who): number {
    return (
      this.sql
        .exec<{ read_seq: number }>('select read_seq from members where who = ?', who)
        .toArray()[0]?.read_seq ?? 0
    )
  }

  private mentionsOf(who: Who): number {
    return this.sql
      .exec<{ many: number }>(
        'select count(*) as many from mentioned where who = ? and seq > ?',
        who,
        this.readPlace(who),
      )
      .one().many
  }

  async read(who: Who, seq: number, back: boolean, from: WebSocket | null): Promise<void> {
    const sql = this.sql
    const to = Math.min(seq, this.head())
    const was = this.readPlace(who)
    if (to === was || (to < was && !back)) return

    sql.exec(
      `insert into members (who, read_seq, dirty) values (?, ?, 1)
       on conflict(who) do update set read_seq = excluded.read_seq, dirty = 1`,
      who,
      to,
    )
    sql.exec('delete from mentioned where who = ? and seq <= ?', who, Math.min(to, was))
    this.flushSoon()

    const frame: ServerFrame = { t: 'read', who, seq: to }
    const shown = this.showsReceipts()
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === from) continue
      const them = attachedTo(socket)
      if (them?.hello && (them.who === who || shown)) say(socket, frame)
    }
    await this.plan()
  }

  private showsReceipts(): boolean {
    const known = this.reachers?.list.length ?? 0
    return known > 0 && known <= RECEIPTS_UP_TO
  }

  private readPlaces(but: Who): { who: Who; seq: number }[] {
    return this.sql
      .exec<{ who: string; read_seq: number }>(
        'select who, read_seq from members where read_seq > 0 and who <> ?',
        but,
      )
      .toArray()
      .map((one) => ({ who: one.who as Who, seq: one.read_seq }))
  }

  private eventsPage(query: URLSearchParams) {
    const limit = Math.max(1, Math.min(wholeIn(query.get('limit')) ?? 200, MOST_PAGE))
    const before = wholeIn(query.get('before'))
    const around = wholeIn(query.get('around'))
    const older = (from: number, many: number) =>
      this.sql
        .exec<EventRow>('select * from events where seq < ? order by seq desc limit ?', from, many)
        .toArray()
        .reverse()
    const newer = (from: number, many: number) =>
      this.sql
        .exec<EventRow>('select * from events where seq > ? order by seq limit ?', from, many)
        .toArray()

    let rows: EventRow[]
    let more: boolean
    if (around !== null) {
      const half = Math.floor(limit / 2)
      rows = [...older(around, half), ...newer(around - 1, limit - half)]
      more = rows.length >= limit
    } else if (before !== null) {
      rows = older(before, limit + 1)
      more = rows.length > limit
      if (more) rows = rows.slice(1)
    } else {
      rows = newer(wholeIn(query.get('after')) ?? 0, limit + 1)
      more = rows.length > limit
      if (more) rows = rows.slice(0, limit)
    }
    return { events: rows.map(loggedOf), more }
  }

  private messageById(id: string | null): Message | null {
    if (!id) return null
    const row = this.sql
      .exec<{ json: string }>('select json from messages where id = ?', id)
      .toArray()[0]
    return row ? (JSON.parse(row.json) as Message) : null
  }

  private statePage(query: URLSearchParams) {
    const limit = Math.max(1, Math.min(wholeIn(query.get('limit')) ?? MOST_MESSAGES, MOST_MESSAGES))
    const before = wholeIn(query.get('before')) ?? Number.MAX_SAFE_INTEGER
    const parent = query.get('parent')
    const head = this.head()
    const rows = this.sql
      .exec<{ seq: number; json: string }>(
        `select seq, json from messages where seq < ? and (deleted = 0 or replies > 0)
            and (? is null or parent = ?)
          order by seq desc limit ?`,
        before,
        parent,
        parent,
        limit + 1,
      )
      .toArray()

    const messages: Message[] = []
    let bytes = 0
    for (const row of rows.slice(0, limit)) {
      bytes += row.json.length
      if (bytes > MOST_PAGE_BYTES && messages.length) break
      messages.push(JSON.parse(row.json) as Message)
    }
    const more = messages.length < rows.length
    return {
      messages,
      meta: metaOf(this.sql),
      seq: head,
      next: more ? (messages.at(-1)?.seq ?? null) : null,
    }
  }

  candidates(asked: unknown): Message[] {
    const words = (
      Array.isArray((asked as { words?: unknown } | null)?.words)
        ? (asked as { words: unknown[] }).words
        : []
    )
      .filter((one): one is string => typeof one === 'string')
      .flatMap((one) => one.split(/[^\p{L}\p{N}]+/u))
      .filter(Boolean)
      .slice(0, 20)
    const rows = words.length
      ? this.sql
          .exec<{ json: string }>(
            `select m.json from messages m
              where m.deleted = 0 and m.seq in (select rowid from words where words match ?)
              order by m.seq desc limit ?`,
            words.map((one) => `"${one.replaceAll('"', '')}"*`).join(' '),
            MOST_CANDIDATES,
          )
          .toArray()
      : this.sql
          .exec<{ json: string }>(
            'select json from messages where deleted = 0 order by seq desc limit ?',
            MOST_CANDIDATES,
          )
          .toArray()
    return rows.map((row) => JSON.parse(row.json) as Message)
  }

  private chatId(): string | null {
    return readMeta(this.sql, 'chat')
  }

  private flushSoon(): void {
    const sql = this.sql
    if (readMeta(sql, 'flush_at') !== null) return
    const last = Number(readMeta(sql, 'flushed_at') ?? 0)
    setMeta(sql, 'flush_at', String(Math.max(Date.now(), last + FLUSH_EVERY)))
  }

  private async flush(): Promise<void> {
    const chat = this.chatId()
    const sql = this.sql
    if (!chat) return
    const head = sql
      .exec<{ seq: number; at: number; author: string }>(
        'select seq, at, author from events order by seq desc limit 1',
      )
      .toArray()[0]
    const meta = metaOf(sql)
    const dirty = sql
      .exec<{ who: string; read_seq: number }>(
        'select who, read_seq from members where dirty = 1 limit 200',
      )
      .toArray()

    await this.env.DB.batch([
      this.env.DB.prepare(
        `update chats set last_seq = ?, last_at = ?, last_by = ?, topic = ?, posting = ?,
           slowmode = ? where id = ?`,
      ).bind(
        head?.seq ?? 0,
        head?.at ?? null,
        head?.author ?? null,
        meta.topic,
        meta.posting,
        meta.slowmode,
        chat,
      ),
      ...dirty
        .filter((one) => !one.who.startsWith('program:'))
        .map((one) =>
          this.env.DB.prepare(
            `insert into chat_reads (chat_id, who, read_seq, mentions) values (?, ?, ?, ?)
             on conflict(chat_id, who) do update
               set read_seq = excluded.read_seq, mentions = excluded.mentions`,
          ).bind(chat, hubIdOf(one.who), one.read_seq, this.mentionsOf(one.who as Who)),
        ),
    ])

    for (const one of dirty) {
      sql.exec('update members set dirty = 0 where who = ? and read_seq = ?', one.who, one.read_seq)
    }
    setMeta(sql, 'flushed_at', String(Date.now()))
    setMeta(sql, 'flush_at', null)
    if (dirty.length === 200) this.flushSoon()
  }

  private async keepFiles(effects: Effects, at: number): Promise<void> {
    const chat = this.chatId()
    if (!chat || !effects.files.length) return
    const rows = effects.files.flatMap((file) => [
      { hash: file.hash, size: file.size, type: file.type, name: file.name },
      ...(file.preview
        ? [{ hash: file.preview, size: 0, type: 'image/webp', name: file.name }]
        : []),
    ])
    await this.env.DB.batch(
      rows.map((one) =>
        this.env.DB.prepare(
          `insert into chat_files (chat_id, hash, size, type, name, at) values (?, ?, ?, ?, ?, ?)
           on conflict(chat_id, hash) do nothing`,
        ).bind(chat, one.hash, one.size, one.type, one.name, at),
      ),
    )
  }

  private async freeFiles(effects: Effects): Promise<void> {
    const chat = this.chatId()
    if (!chat || !effects.freed.length) return
    const hashes = effects.freed.flatMap((file) =>
      file.preview ? [file.hash, file.preview] : [file.hash],
    )
    const loose = hashes.filter((hash) => !this.sql.exec(NAMES_FILE, hash).toArray().length)
    if (!loose.length) return
    const poster = effects.freedBy
    await this.env.DB.batch([
      ...(poster && !poster.startsWith('guest:')
        ? [noteUnusedBy(this.env, hubIdOf(poster), loose, Date.now())]
        : []),
      this.env.DB.prepare(
        `delete from chat_files where chat_id = ? and hash in (${places(loose.length)})`,
      ).bind(chat, ...loose),
    ])
  }

  private async reachersNow(): Promise<{ id: string; guest: boolean }[]> {
    const now = Date.now()
    if (this.reachers && now - this.reachers.at < REACHERS_FOR) return this.reachers.list
    const chat = this.chatId()
    const list = chat ? await reaching(this.env, chat) : []
    this.reachers = { at: now, list }
    return list
  }

  private async poke(logged: Logged, called: readonly Who[]): Promise<void> {
    let reachers: { id: string; guest: boolean }[]
    try {
      reachers = await this.reachersNow()
    } catch (error) {
      note(`chat ${this.chatId()} reachers`, error, null)
      return
    }
    const open = new Set(this.here().map(hubIdOf))
    const named = new Set(called.map(hubIdOf))
    const now = Date.now()
    const sql = this.sql
    const sendNow: string[] = []

    for (const one of reachers) {
      if (open.has(one.id)) continue
      const row = sql
        .exec<{ sent_at: number; mention: number }>(
          'select sent_at, mention from pokes where id = ?',
          one.id,
        )
        .toArray()[0]
      const mention = named.has(one.id) || row?.mention === 1 ? 1 : 0
      sql.exec(
        `insert into pokes (id, sent_at, seq, at, by, mention) values (?, ?, ?, ?, ?, ?)
         on conflict(id) do update set seq = excluded.seq, at = excluded.at, by = excluded.by,
           mention = excluded.mention`,
        one.id,
        row?.sent_at ?? 0,
        logged.seq,
        logged.at,
        logged.author,
        mention,
      )
      if (!row || now - row.sent_at >= POKE_EVERY) sendNow.push(one.id)
    }
    await this.sendPokes(sendNow, now)
  }

  private async sendPokes(ids: readonly string[], now: number): Promise<void> {
    const chat = this.chatId()
    if (!chat || !ids.length) return
    const sql = this.sql
    await Promise.all(
      ids.map(async (id) => {
        const row = sql
          .exec<{ seq: number | null; at: number | null; by: string | null; mention: number }>(
            'select seq, at, by, mention from pokes where id = ?',
            id,
          )
          .toArray()[0]
        if (row?.seq === null || row?.seq === undefined) return
        sql.exec(
          'update pokes set sent_at = ?, seq = null, at = null, by = null, mention = 0 where id = ?',
          now,
          id,
        )
        await askHub(this.env, id, 'chat', {
          'x-nib-chat': chat,
          'x-nib-seq': String(row.seq),
          'x-nib-at': String(row.at ?? now),
          'x-nib-by': row.by ?? '',
          'x-nib-mention': row.mention === 1 ? 'yes' : 'no',
        })
      }),
    )
  }

  async alarm(): Promise<void> {
    await this.askSignIns()
    const now = Date.now()
    const flushAt = Number(readMeta(this.sql, 'flush_at') ?? Number.NaN)
    try {
      if (flushAt <= now) await this.flush()
    } catch (error) {
      note(`chat ${this.chatId()} flush`, error, null)
    }
    try {
      const owed = this.sql
        .exec<{ id: string }>(
          'select id from pokes where seq is not null and sent_at <= ?',
          now - POKE_EVERY,
        )
        .toArray()
      await this.sendPokes(
        owed.map((one) => one.id),
        now,
      )
    } catch (error) {
      note(`chat ${this.chatId()} pokes`, error, null)
    }
    try {
      await this.placeDue(now)
    } catch (error) {
      note(`chat ${this.chatId()} scheduled`, error, null)
    }
    await this.plan()
  }

  private async plan(): Promise<void> {
    const sql = this.sql
    const flushAt = readMeta(sql, 'flush_at')
    const poke = sql
      .exec<{ at: number | null }>('select min(sent_at) as at from pokes where seq is not null')
      .one().at
    const scheduled = sql
      .exec<{ at: number | null }>(
        `select min(max(s.send_at, coalesce(t.next_at, 0))) as at from scheduled s
          left join scheduled_tries t on t.id = s.id
          where s.refused is null`,
      )
      .one().at
    const times = [
      flushAt === null ? null : Number(flushAt),
      poke === null ? null : poke + POKE_EVERY,
      scheduled,
    ].filter((one): one is number => one !== null && Number.isFinite(one))
    if (!times.length) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    await this.ctx.storage.setAlarm(Math.max(Math.min(...times), Date.now()))
  }

  private async askSignIns(): Promise<Set<WebSocket>> {
    const closed = new Set<WebSocket>()
    const now = Date.now()
    if (now - this.signInsAskedAt < ASK_SIGNINS_EVERY) return closed
    this.signInsAskedAt = now

    const sockets = this.ctx.getWebSockets()
    const logins = sockets.flatMap((one) => attachedTo(one)?.login ?? [])
    if (!logins.length) return closed

    const live = await stillSignedIn(this.env, logins).catch(() => null)
    if (!live) return closed

    for (const socket of sockets) {
      const login = attachedTo(socket)?.login
      if (login === undefined || live.has(login)) continue
      socket.close(SIGNED_OUT, 'signed out')
      closed.add(socket)
    }
    await this.askAccess(sockets, closed)
    if (!closed.size) return closed

    const gone = new Set([...closed].flatMap((one) => attachedTo(one)?.id ?? []))
    for (const socket of sockets) {
      if (!closed.has(socket)) gone.delete(attachedTo(socket)?.id ?? '')
    }
    for (const id of gone) await this.forgetSocketRow(id)
    this.reachers = null
    for (const socket of sockets) {
      if (!closed.has(socket) && attachedTo(socket)?.hello) {
        say(socket, { t: 'here', who: this.here().filter((one) => !this.closedWho(closed, one)) })
      }
    }
    return closed
  }

  private async askAccess(sockets: WebSocket[], closed: Set<WebSocket>): Promise<void> {
    const chat = this.chatId()
    if (!chat) return
    const logins = [
      ...new Set(sockets.flatMap((one) => (closed.has(one) ? [] : (attachedTo(one)?.login ?? [])))),
    ]
    if (!logins.length) return

    const at = Date.now()
    const asked = await Promise.all(
      logins.map(async (login) => [login, await reachByToken(this.env, login, at, chat)] as const),
    ).catch(() => null)
    if (!asked) return
    const reached = new Map(asked)

    let chatLives: boolean | null = null
    for (const socket of sockets) {
      const them = attachedTo(socket)
      if (!them?.login || closed.has(socket)) continue
      const answer = reached.get(them.login)
      if (!answer?.live) continue
      if (answer.reached) {
        if (answer.reached.role === 'read' && them.role !== 'read') {
          attach(socket, { ...them, role: 'read' })
        }
        continue
      }
      chatLives ??= await this.lives(chat).catch(() => false)
      if (!chatLives) continue
      socket.close(1008, 'no longer in this space')
      closed.add(socket)
    }
  }

  private async lives(chat: string): Promise<boolean> {
    const row = await this.env.DB.prepare(
      `select 1 as yes from chats ch join spaces sp on sp.id = ch.space_id
        where ch.id = ? and ch.ended_at is null and sp.deleted = 0`,
    )
      .bind(chat)
      .first<{ yes: number }>()
    return row !== null
  }

  private closedWho(closed: Set<WebSocket>, who: Who): boolean {
    return this.ctx.getWebSockets(who).every((one) => closed.has(one))
  }

  private async revoke(id: string, role: string | null): Promise<Response> {
    this.reachers = null
    const toRead = role === 'read'
    for (const socket of this.ctx.getWebSockets()) {
      const them = attachedTo(socket)
      if (them?.id !== id) continue
      if (toRead) attach(socket, { ...them, role: 'read' })
      else socket.close(1008, 'no longer in this space')
    }
    if (!toRead) {
      await this.forgetSocketRow(id)
      this.sayHere()
    }
    return new Response(null, { status: 204 })
  }

  private async erase(): Promise<Response> {
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, 'this chat is gone')
    this.reachers = null
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.ready = false
    return new Response(null, { status: 204 })
  }

  private async writeSocketRow(who: string): Promise<void> {
    const chat = this.chatId()
    const space = readMeta(this.sql, 'space')
    if (!chat || !space) return
    await this.env.DB.prepare(
      `insert into chat_sockets (chat_id, space_id, who, opened_at) values (?, ?, ?, ?)
       on conflict(chat_id, who) do update
         set space_id = excluded.space_id, opened_at = excluded.opened_at`,
    )
      .bind(chat, space, who, Date.now())
      .run()
  }

  private async sweep(): Promise<void> {
    const chat = this.chatId()
    await sweepOpened(this.env, { name: 'chat_sockets', key: 'chat_id' }, async (other, them) =>
      other === chat
        ? this.hasSocketOf(them)
        : await openIn(await askChat(this.env, other, 'open', { [OPEN_HEADER]: them })),
    )
  }

  private hasSocketOf(id: string): boolean {
    return !!id && this.ctx.getWebSockets().some((socket) => attachedTo(socket)?.id === id)
  }

  private async forgetSocketRow(who: string): Promise<void> {
    const chat = this.chatId()
    if (!chat) return
    await this.env.DB.prepare('delete from chat_sockets where chat_id = ? and who = ?')
      .bind(chat, who)
      .run()
  }
}

function personOf(headers: Headers): Person | null {
  const id = headers.get('x-nib-who') ?? ''
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  const guest = headers.get('x-nib-guest') === 'yes'
  const role = headers.get('x-nib-role')
  const device = headers.get('x-nib-device')
  return {
    id,
    guest,
    who: guest ? `guest:${id}` : `user:${id}`,
    role: role === 'owner' || role === 'write' ? role : 'read',
    ...(device ? { device } : {}),
  }
}

function resultOf(answer: Answer) {
  return answer.t === 'placed'
    ? { id: answer.id, seq: answer.seq, at: answer.at }
    : { id: answer.id ?? '', refused: answer.error }
}
