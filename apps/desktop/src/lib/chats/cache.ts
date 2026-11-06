import { type Event, type Has, hasOf, type Message, type Who } from '@orden/chats'
import type { ChatRow, Refusal } from '@orden/chats/wire'
import type { Kept } from './fold'

export interface CachedChat {
  id: string
  space: string
  seq: number
  readSeq: number
  older: number | null
  complete: boolean
  row: ChatRow | null
}

export interface OutboxRow {
  id: string
  chat: string
  event: Event
  madeAt: number
  tries: number
  refused: Refusal | null
}

export interface DraftRow {
  chat: string
  text: string
  at: number
}

export interface WindowAsk {
  chat: string
  parent?: string
  before?: number
  after?: number
  around?: number
  limit: number
}

export interface SearchAsk {
  chats?: string[]
  words?: string[]
  phrases?: string[]
  has?: Has[]
  authors?: Who[]
  reply?: boolean
  since?: number
  until?: number
  limit: number
}

export type CacheChange =
  | { t: 'chat'; chat: CachedChat }
  | { t: 'message'; chat: string; kept: Kept }
  | { t: 'unmessage'; chat: string; id: string }
  | { t: 'queue'; row: OutboxRow }
  | { t: 'unqueue'; id: string }
  | { t: 'draft'; draft: DraftRow }
  | { t: 'undraft'; chat: string }
  | { t: 'forget'; chat: string }

export interface ChatCache {
  chats(): Promise<CachedChat[]>
  window(ask: WindowAsk): Promise<Kept[]>
  messages(chat: string, ids: readonly string[]): Promise<Kept[]>
  search(ask: SearchAsk): Promise<{ chat: string; kept: Kept }[]>
  unread(chat: string, after: number, me: Who): Promise<number>
  outbox(): Promise<OutboxRow[]>
  drafts(): Promise<DraftRow[]>
  write(changes: readonly CacheChange[]): Promise<void>
  forget(): Promise<void>
}

export function isMain(message: Message): boolean {
  return message.parent === undefined || message.alsoToChat
}

export function hasColumn(message: Message): string {
  return ` ${hasOf(message).join(' ')} `
}

function folded(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

function wordsOf(text: string): string[] {
  return folded(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

export class MemoryCache implements ChatCache {
  private readonly chatRows = new Map<string, CachedChat>()
  private readonly rows = new Map<string, Map<string, Kept>>()
  private readonly queued = new Map<string, OutboxRow>()
  private readonly drafted = new Map<string, DraftRow>()

  chats(): Promise<CachedChat[]> {
    return Promise.resolve([...this.chatRows.values()])
  }

  window(ask: WindowAsk): Promise<Kept[]> {
    const all = [...(this.rows.get(ask.chat)?.values() ?? [])]
      .filter((one) =>
        ask.parent === undefined ? isMain(one.message) : one.message.parent === ask.parent,
      )
      .sort((a, b) => a.message.seq - b.message.seq)
    const limit = Math.max(1, ask.limit)
    const older = (from: number, many: number) =>
      all.filter((one) => one.message.seq < from).slice(-many || all.length)
    const newer = (from: number, many: number) =>
      all.filter((one) => one.message.seq > from).slice(0, many)
    if (ask.around !== undefined) {
      const half = Math.floor(limit / 2)
      return Promise.resolve([
        ...(half > 0 ? older(ask.around, half) : []),
        ...newer(ask.around - 1, limit - half),
      ])
    }
    if (ask.after !== undefined) return Promise.resolve(newer(ask.after, limit))
    return Promise.resolve(older(ask.before ?? Number.MAX_SAFE_INTEGER, limit))
  }

  messages(chat: string, ids: readonly string[]): Promise<Kept[]> {
    const rows = this.rows.get(chat)
    return Promise.resolve(
      ids.flatMap((id) => rows?.get(id) ?? []).sort((a, b) => a.message.seq - b.message.seq),
    )
  }

  search(ask: SearchAsk): Promise<{ chat: string; kept: Kept }[]> {
    const found: { chat: string; kept: Kept }[] = []
    for (const [chat, rows] of this.rows) {
      if (ask.chats?.length && !ask.chats.includes(chat)) continue
      for (const kept of rows.values()) {
        const message = kept.message
        if (message.deleted) continue
        if (ask.authors?.length && !ask.authors.includes(message.author)) continue
        if (ask.reply && message.parent === undefined) continue
        if (ask.since !== undefined && message.at < ask.since) continue
        if (ask.until !== undefined && message.at >= ask.until) continue
        const has = hasOf(message)
        if (ask.has?.some((one) => !has.includes(one))) continue
        const words = wordsOf(message.body)
        const body = folded(message.body)
        if (ask.words?.some((one) => !words.some((word) => word.startsWith(folded(one))))) continue
        if (ask.phrases?.some((one) => !body.includes(folded(one)))) continue
        found.push({ chat, kept })
      }
    }
    found.sort(
      (a, b) => b.kept.message.at - a.kept.message.at || b.kept.message.seq - a.kept.message.seq,
    )
    return Promise.resolve(found.slice(0, ask.limit))
  }

  unread(chat: string, after: number, me: Who): Promise<number> {
    let count = 0
    for (const { message } of this.rows.get(chat)?.values() ?? []) {
      if (isMain(message) && message.seq > after && message.author !== me && !message.deleted)
        count += 1
    }
    return Promise.resolve(count)
  }

  outbox(): Promise<OutboxRow[]> {
    return Promise.resolve(
      [...this.queued.values()].sort((a, b) => a.madeAt - b.madeAt || (a.id < b.id ? -1 : 1)),
    )
  }

  drafts(): Promise<DraftRow[]> {
    return Promise.resolve([...this.drafted.values()])
  }

  write(changes: readonly CacheChange[]): Promise<void> {
    for (const change of changes) {
      switch (change.t) {
        case 'chat':
          this.chatRows.set(change.chat.id, change.chat)
          break
        case 'message': {
          let rows = this.rows.get(change.chat)
          if (!rows) this.rows.set(change.chat, (rows = new Map<string, Kept>()))
          rows.set(change.kept.message.id, change.kept)
          break
        }
        case 'unmessage':
          this.rows.get(change.chat)?.delete(change.id)
          break
        case 'queue':
          this.queued.set(change.row.id, change.row)
          break
        case 'unqueue':
          this.queued.delete(change.id)
          break
        case 'draft':
          this.drafted.set(change.draft.chat, change.draft)
          break
        case 'undraft':
          this.drafted.delete(change.chat)
          break
        case 'forget':
          this.chatRows.delete(change.chat)
          this.rows.delete(change.chat)
          this.drafted.delete(change.chat)
          break
      }
    }
    return Promise.resolve()
  }

  forget(): Promise<void> {
    this.chatRows.clear()
    this.rows.clear()
    this.queued.clear()
    this.drafted.clear()
    return Promise.resolve()
  }
}
