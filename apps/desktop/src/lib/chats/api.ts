import type {
  Event,
  FileRef,
  Message,
  Meta,
  Notify,
  Poll,
  Post,
  Preview,
  Role,
  SearchQuery,
  Who,
} from '@orden/chats'
import type { Capabilities, Delivery } from '@orden/chats/provider'
import type { Refusal } from '@orden/chats/wire'

export interface Shown extends Message {
  sending: boolean
  refused: Refusal | null
  delivery?: Delivery
  tally?: readonly number[]
  system?: boolean
  forwarded?: boolean
  subject?: string
}

export type Formatting = NonNullable<Capabilities['formatting']>

export interface ChatAbilities {
  files: boolean
  maxFile: number | null
  voice: boolean
  polls: boolean
  quote: boolean
  threads: boolean
  react: 'any' | 'one' | readonly string[] | null
  editFor: number | null
  removeFor: number | null
  removeForMe: boolean
  pin: boolean
  vote: boolean
  markUnread: boolean
  members: boolean
  topic: boolean
  mute: boolean
  search: boolean
  link: boolean
  schedule: boolean
  unsend: boolean
  nib: boolean
  stickers: boolean
  gifs: boolean
  formatting: Formatting
}

export interface Service {
  provider: string
  account: string
  conversation: string
  icon: string
  name: string
}

export interface ChatEntry {
  id: string
  space: string
  root: string | null
  path: string | null
  name: string | null
  role: Role
  members: number
  lastSeq: number
  lastAt: number | null
  lastBy: Who | null
  readSeq: number
  unread: number
  mentions: number
  notify: Notify | null
  mutedUntil: number | null
  meta: Meta
}

export interface ChatMember {
  who: Who
  name: string | null
  role: Role
}

export interface Presence {
  here: readonly Who[]
  typing: readonly { who: Who; parent?: string }[]
  reads: ReadonlyMap<Who, number>
}

export interface Draft {
  body: string
  parent?: string
  quote?: string
  files?: FileRef[]
  poll?: Poll
  preview?: Preview
  alsoToChat?: boolean
  via?: { agent: string }
  sticker?: string
}

export interface Scheduled {
  id: string
  sendAt: number
  post: Post
}

export interface HistoryAsk {
  limit: number
  before?: number
  after?: number
  around?: string
  parent?: string
}

export interface Offer {
  chat: string
  parent?: string
  text: string
  note?: string
}

export interface Hit {
  chat: string
  message: Message
}

export interface MessageList {
  readonly messages: readonly Shown[]
  readonly pending: readonly Shown[]
  readonly atStart: boolean
  readonly atEnd: boolean
  readonly loading: boolean
  watch(listener: () => void): () => void
}

export interface RepliesView extends MessageList {
  readonly parent: Shown | null
  close(): void
}

export interface ChatView extends MessageList {
  readonly chat: string
  readonly can?: ChatAbilities
  readonly me?: Who | null
  readonly service?: Service | undefined
  readonly entry: ChatEntry | null
  readonly meta: Meta
  readonly role: Role | null
  readonly members: readonly ChatMember[]
  readonly presence: Presence
  readonly lineAt: number
  older(): Promise<void>
  newer(): Promise<void>
  jump(message: string): Promise<boolean>
  latest(): Promise<void>
  replies(parent: string): RepliesView
  read(seq: number): void
  markUnread(seq: number): void
  typed(parent?: string): void
  close(): void
}

export interface Chats {
  readonly list: readonly ChatEntry[]
  readonly ready: boolean
  readonly me: Who | null
  watch(listener: () => void): () => void
  heard(listener: (chat: string, messages: readonly Message[]) => void): () => void
  entry(chat: string): ChatEntry | null
  message(chat: string, id: string): Promise<Message | null>
  markRead(chat: string, seq: number): Promise<void>
  receipts: boolean

  open(chat: string): ChatView

  send(chat: string, event: Event): Promise<void>
  post(chat: string, draft: Draft): Promise<string>
  schedule(chat: string, draft: Draft, sendAt: number): Promise<string>
  scheduled(chat: string): Promise<Scheduled[]>
  edit(chat: string, message: string, body: string, files?: FileRef[]): Promise<void>
  remove(chat: string, message: string, everyone?: boolean): Promise<void>
  react(chat: string, message: string, emoji: string, on: boolean): Promise<void>
  pin(chat: string, message: string, on: boolean): Promise<void>
  vote(chat: string, message: string, answers: number[]): Promise<void>
  setMeta(chat: string, meta: Partial<Meta>): Promise<void>
  unsend(chat: string): Promise<string | null>
  retry(chat: string, message: string): Promise<void>
  discard(chat: string, message: string): Promise<void>

  notifyFor(chat: string, notify: Notify | null, mutedUntil: number | null): Promise<void>
  members(chat: string): Promise<ChatMember[]>

  search(query: string, chat?: string): Promise<Hit[]>
  parse(query: string): SearchQuery
  linking(names: readonly string[]): Promise<Hit[]>

  history(chat: string, ask: HistoryAsk): Promise<Message[]>

  draft(chat: string): string
  keepDraft(chat: string, text: string): void
  offer(chat: string, text: string, more?: { parent?: string; note?: string }): void
  offers(listener: (offer: Offer) => void): () => void
  takeOffer(chat: string, parent?: string): Offer | null
  noteReach(chat: string, path: string): Promise<{ missing: ChatMember[]; share: boolean } | null>
  shareNote(chat: string, path: string): Promise<boolean>

  upload(bytes: Uint8Array, chat?: string): Promise<string | null>
  fileUrl(chat: string, hash: string): Promise<string | null>
  readonly fileEpoch: number
  preview(url: string): Promise<Preview | null>

  make(folder: string, name: string): Promise<string | null>
  chatAt(path: string): Promise<string | null>
}
