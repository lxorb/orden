import type { Event, Logged, Message, Meta, Who } from '@orden/chats'
import { MOST_BEHIND } from '@orden/chats/limits'
import {
  type ChatList,
  type ChatPoke,
  eventOf,
  type EventsPage,
  type Results,
  type StatePage,
} from '@orden/chats/wire'
import { roomDelay } from '../platform/src/api'
import type { CacheChange, CachedChat, ChatCache, OutboxRow } from './cache'
import { foldAll, type Kept, type Lookup, marksOf } from './fold'

export interface Remote {
  list(): Promise<ChatList | null>
  events(chat: string, after: number): Promise<EventsPage | null>
  state(chat: string, before?: number): Promise<StatePage | null>
  post(chat: string, events: readonly Event[]): Promise<Results | 'gone' | null>
  read(chat: string, seq: number, back: boolean): Promise<boolean>
}

export type Change =
  | { t: 'messages'; chat: string; kept: Kept[]; gone: string[]; arrived: Message[] }
  | { t: 'outbox'; chat: string }
  | { t: 'list' }

const BATCH = 50

const PAGES_A_TURN = 20

export class ChatEngine {
  readonly chats = new Map<string, CachedChat>()
  private outbox: OutboxRow[] = []
  private readonly placed = new Map<string, number>()
  private readonly lines = new Map<string, Promise<unknown>>()
  private readonly sending = new Set<string>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly tries = new Map<string, number>()
  private readonly listeners = new Set<(change: Change) => void>()
  private stopped = false

  constructor(
    private readonly cache: ChatCache,
    private readonly remote: Remote,
    private readonly me: () => Who | null,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    for (const chat of await this.cache.chats()) this.chats.set(chat.id, chat)
    this.outbox = await this.cache.outbox()
  }

  listen(listener: (change: Change) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stop(): void {
    this.stopped = true
    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()
  }

  private say(change: Change): void {
    for (const listener of this.listeners) listener(change)
  }

  private line<T>(chat: string, work: () => Promise<T>): Promise<T> {
    const before = this.lines.get(chat) ?? Promise.resolve()
    const next = before.then(work, work)
    this.lines.set(
      chat,
      next.catch(() => undefined),
    )
    return next
  }

  private chatOf(id: string, space = ''): CachedChat {
    let chat = this.chats.get(id)
    if (!chat) {
      chat = { id, space, seq: 0, readSeq: 0, older: null, complete: false, row: null }
      this.chats.set(id, chat)
    }
    return chat
  }

  async refresh(): Promise<boolean> {
    const listed = await this.remote.list()
    if (!listed || this.stopped) return false
    const ids = new Set(listed.chats.map((row) => row.id))
    const changes: CacheChange[] = []
    for (const row of listed.chats) {
      const chat = this.chatOf(row.id, row.space)
      chat.space = row.space
      chat.row = row
      chat.readSeq = row.readSeq
      changes.push({ t: 'chat', chat: { ...chat } })
    }
    for (const id of [...this.chats.keys()]) {
      if (ids.has(id)) continue
      this.chats.delete(id)
      changes.push({ t: 'forget', chat: id })
      for (const row of this.outbox.filter((one) => one.chat === id && !one.refused)) {
        row.refused = 'gone'
        changes.push({ t: 'queue', row: { ...row } })
      }
    }
    await this.cache.write(changes)
    this.say({ t: 'list' })
    void this.catchUpAll()
    return true
  }

  async catchUpAll(): Promise<void> {
    for (const chat of [...this.chats.values()]) {
      if (this.stopped) return
      if ((chat.row?.lastSeq ?? 0) > chat.seq || (chat.seq === 0 && !chat.complete)) {
        await this.sync(chat.id).catch(() => undefined)
      }
    }
  }

  poked(poke: ChatPoke): void {
    const chat = this.chats.get(poke.chat)
    if (chat?.row && poke.seq > chat.row.lastSeq) {
      const mine = poke.by === this.me()
      chat.row = {
        ...chat.row,
        lastSeq: poke.seq,
        lastAt: poke.at,
        lastBy: poke.by,
        mentions: chat.row.mentions + (poke.mention && !mine ? 1 : 0),
        readSeq: mine ? Math.max(chat.row.readSeq, poke.seq) : chat.row.readSeq,
      }
      this.say({ t: 'list' })
    }
    if (chat) void this.sync(poke.chat).catch(() => undefined)
    else void this.refresh()
  }

  sync(id: string): Promise<void> {
    return this.line(id, async () => {
      const chat = this.chatOf(id)
      const head = chat.row?.lastSeq ?? 0
      if ((chat.seq === 0 && !chat.complete) || head - chat.seq > MOST_BEHIND) {
        if (!(await this.firstCopy(chat))) return
      }
      for (let pages = 0; pages < PAGES_A_TURN && !this.stopped; pages++) {
        const page = await this.remote.events(id, chat.seq)
        if (!page) return
        await this.folded(chat, page.events)
        if (!page.more || !page.events.length) return
      }
      void this.sync(id)
    })
  }

  heard(id: string, events: readonly Logged[]): Promise<void> {
    return this.line(id, async () => {
      const chat = this.chatOf(id)
      const first = events[0]
      if (!first) return
      if (first.seq > chat.seq + 1 || (chat.seq === 0 && !chat.complete)) {
        void this.sync(id)
        return
      }
      await this.folded(chat, events)
    })
  }

  behind(id: string, seq: number): void {
    const chat = this.chatOf(id)
    if (chat.row) chat.row = { ...chat.row, lastSeq: Math.max(chat.row.lastSeq, seq) }
    void this.sync(id)
  }

  private async firstCopy(chat: CachedChat): Promise<boolean> {
    const page = await this.remote.state(chat.id)
    if (!page) return false
    const kept = page.messages.map((message): Kept => ({
      message,
      upto: page.seq,
      marks: marksOf(message, page.seq),
    }))
    chat.seq = page.seq
    chat.older = page.next
    chat.complete = page.next === null
    if (chat.row) chat.row = { ...chat.row, meta: page.meta }
    await this.cache.write([
      { t: 'forget', chat: chat.id },
      { t: 'chat', chat: { ...chat } },
      ...kept.map((one): CacheChange => ({ t: 'message', chat: chat.id, kept: one })),
    ])
    this.settle(chat)
    this.say({ t: 'messages', chat: chat.id, kept, gone: [], arrived: [] })
    return true
  }

  fill(id: string): Promise<boolean> {
    return this.line(id, async () => {
      const chat = this.chatOf(id)
      if (chat.complete || (chat.seq === 0 && chat.older === null)) return false
      const page = await this.remote.state(id, chat.older ?? undefined)
      if (!page) return false
      const have = new Set(
        (
          await this.cache.messages(
            id,
            page.messages.map((one) => one.id),
          )
        ).map((one) => one.message.id),
      )
      const kept = page.messages
        .filter((one) => !have.has(one.id))
        .map((message): Kept => ({ message, upto: page.seq, marks: marksOf(message, page.seq) }))
      chat.older = page.next
      chat.complete = page.next === null
      await this.cache.write([
        { t: 'chat', chat: { ...chat } },
        ...kept.map((one): CacheChange => ({ t: 'message', chat: id, kept: one })),
      ])
      this.say({ t: 'messages', chat: id, kept, gone: [], arrived: [] })
      return true
    })
  }

  private async folded(chat: CachedChat, events: readonly Logged[]): Promise<void> {
    const id = chat.id
    const lookup: Lookup = {
      get: async (one) => (await this.cache.messages(id, [one]))[0],
      newestReply: async (parent, except) => {
        const replies = await this.cache.window({ chat: id, parent, limit: 50 })
        return replies
          .map((one) => one.message)
          .filter((one) => !one.deleted && !except.has(one.id))
          .at(-1)
      },
    }
    const { kept, gone, seq } = await foldAll(events, lookup, chat.seq)
    if (seq === chat.seq) return

    const me = this.me()
    const fresh = events.filter((one) => one.seq > chat.seq)
    for (const event of fresh) {
      if (event.kind === 'meta' && chat.row)
        chat.row = { ...chat.row, meta: metaWith(chat.row.meta, event) }
      if (event.author === me && chat.row) {
        chat.row = { ...chat.row, readSeq: Math.max(chat.row.readSeq, event.seq) }
      }
    }
    chat.seq = seq
    if (chat.row && seq > chat.row.lastSeq) {
      const last = fresh.at(-1)
      chat.row = {
        ...chat.row,
        lastSeq: seq,
        lastAt: last?.at ?? null,
        lastBy: last?.author ?? null,
      }
    }

    await this.cache.write([
      { t: 'chat', chat: { ...chat } },
      ...[...kept.values()].map((one): CacheChange => ({ t: 'message', chat: id, kept: one })),
      ...[...gone].map((one): CacheChange => ({ t: 'unmessage', chat: id, id: one })),
    ])
    const arrived = fresh.flatMap((event) => {
      if (event.kind !== 'post' || event.author === me) return []
      const message = kept.get(event.message)?.message
      return message ? [message] : []
    })
    this.settle(chat)
    this.say({ t: 'messages', chat: id, kept: [...kept.values()], gone: [...gone], arrived })
    this.say({ t: 'list' })
  }

  pending(chat: string): readonly OutboxRow[] {
    const held = this.chats.get(chat)?.seq ?? 0
    return this.outbox.filter(
      (row) => row.chat === chat && !((this.placed.get(row.id) ?? Infinity) <= held),
    )
  }

  async queue(chat: string, event: Event): Promise<void> {
    const checked = eventOf(event)
    if (!checked) throw new Error(`a ${event.kind} the account would not read`)
    const row: OutboxRow = {
      id: checked.id,
      chat,
      event: checked,
      madeAt: this.now(),
      tries: 0,
      refused: null,
    }
    await this.cache.write([{ t: 'queue', row }])
    this.outbox.push(row)
    this.say({ t: 'outbox', chat })
    void this.flush(chat)
  }

  async drop(ids: readonly string[]): Promise<void> {
    const gone = new Set(ids)
    const chats = new Set(this.outbox.filter((row) => gone.has(row.id)).map((row) => row.chat))
    this.outbox = this.outbox.filter((row) => !gone.has(row.id))
    await this.cache.write(ids.map((id): CacheChange => ({ t: 'unqueue', id })))
    for (const chat of chats) this.say({ t: 'outbox', chat })
  }

  async retry(ids: readonly string[]): Promise<void> {
    const again = new Set(ids)
    const changes: CacheChange[] = []
    const chats = new Set<string>()
    for (const row of this.outbox) {
      if (!again.has(row.id) || !row.refused) continue
      row.refused = null
      row.tries = 0
      changes.push({ t: 'queue', row: { ...row } })
      chats.add(row.chat)
    }
    await this.cache.write(changes)
    for (const chat of chats) {
      this.say({ t: 'outbox', chat })
      void this.flush(chat)
    }
  }

  async flushAll(): Promise<void> {
    await Promise.all(
      [...new Set(this.outbox.map((row) => row.chat))].map((chat) => this.flush(chat)),
    )
  }

  private halted(): boolean {
    return this.stopped
  }

  async flush(chat: string): Promise<void> {
    if (this.sending.has(chat) || this.stopped) return
    this.sending.add(chat)
    clearTimeout(this.retries.get(chat))
    this.retries.delete(chat)
    let placedAny = false
    let later = false
    try {
      while (!this.halted()) {
        const batch = this.outbox
          .filter((row) => row.chat === chat && !row.refused && !this.placed.has(row.id))
          .slice(0, BATCH)
        if (!batch.length) break
        const answer = await this.remote.post(
          chat,
          batch.map((row) => row.event),
        )
        if (answer === null) {
          later = true
          break
        }
        const changes: CacheChange[] = []
        const dropped: string[] = []
        if (answer === 'gone') {
          for (const row of batch) {
            row.refused = 'gone'
            changes.push({ t: 'queue', row: { ...row } })
          }
        } else {
          const results = new Map(answer.results.map((one) => [one.id, one]))
          for (const row of batch) {
            const result = results.get(row.id)
            if (!result) {
              later = true
            } else if ('refused' in result) {
              if (result.refused === 'rate') {
                later = true
                row.tries += 1
              } else row.refused = result.refused
              changes.push({ t: 'queue', row: { ...row } })
            } else if (result.seq === 0) {
              dropped.push(row.id)
            } else {
              this.placed.set(row.id, result.seq)
              placedAny = true
            }
          }
        }
        await this.cache.write(changes)
        if (dropped.length) await this.drop(dropped)
        this.say({ t: 'outbox', chat })
        if (later) break
      }
    } finally {
      this.sending.delete(chat)
    }
    if (later) this.again(chat)
    else this.tries.delete(chat)
    if (!placedAny) return
    const held = this.chats.get(chat)
    if (held) this.settle(held)
    await this.sync(chat)
  }

  private again(chat: string): void {
    if (this.stopped || this.retries.has(chat)) return
    const tries = (this.tries.get(chat) ?? 0) + 1
    this.tries.set(chat, tries)
    this.retries.set(
      chat,
      setTimeout(() => {
        this.retries.delete(chat)
        void this.flush(chat)
      }, roomDelay(tries)),
    )
  }

  private settle(chat: CachedChat): void {
    const done = this.outbox
      .filter((row) => row.chat === chat.id && (this.placed.get(row.id) ?? Infinity) <= chat.seq)
      .map((row) => row.id)
    if (!done.length) return
    for (const id of done) this.placed.delete(id)
    void this.drop(done)
  }

  readTo(id: string, seq: number, back = false): boolean {
    const chat = this.chats.get(id)
    const row = chat?.row
    if (!chat || !row) return false
    if (back ? seq >= row.readSeq : seq <= row.readSeq) return false
    chat.readSeq = seq
    chat.row = { ...row, readSeq: seq, mentions: seq >= row.lastSeq ? 0 : row.mentions }
    void this.cache.write([{ t: 'chat', chat: { ...chat } }])
    this.say({ t: 'list' })
    return true
  }

  tellRead(chat: string, seq: number, back: boolean): Promise<boolean> {
    return this.remote.read(chat, seq, back)
  }
}

function metaWith(meta: Meta, event: Extract<Event, { kind: 'meta' }>): Meta {
  return {
    topic: event.topic ?? meta.topic,
    posting: event.posting ?? meta.posting,
    slowmode: event.slowmode ?? meta.slowmode,
  }
}
