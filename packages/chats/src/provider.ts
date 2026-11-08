import type { Parsed } from './mail/mime'

export type ConversationKind = 'direct' | 'group' | 'channel' | 'thread'

export interface ConnectField {
  key: string
  label: string
  kind: 'text' | 'email' | 'password' | 'number' | 'select' | 'phone' | 'url'
  secret?: boolean
  note?: string
  optional?: boolean
  initial?: string
  placeholder?: string
  options?: readonly { value: string; label: string }[]
  help?: ConnectHelp
}

export interface ConnectHelp {
  url: string
  label: string
  steps?: readonly string[]
}

export interface Person {
  id: string
  name: string
  handle?: string
  phone?: string
  picture?: string
}

export type ConversationRole = 'member' | 'admin' | 'owner'

export interface Member extends Person {
  role: ConversationRole
  online?: boolean
  lastSeen?: number
}

export interface Conversation {
  id: string
  title: string | null
  kind: ConversationKind
  people: readonly Person[]
  lastAt: number | null
  unread: number
  mentions?: number
  mutedUntil?: number | null
  snippet?: string
  pinned?: boolean
  archived?: boolean
  topic?: string
  picture?: string
  role?: ConversationRole
  readOnly?: boolean
  members?: number
}

export type AttachmentKind = 'file' | 'image' | 'video' | 'audio' | 'voice' | 'sticker' | 'gif'

export interface AttachmentRef {
  ref: string
  name: string
  type: string
  size: number
  kind?: AttachmentKind
  width?: number
  height?: number
  seconds?: number
  wave?: readonly number[]
  preview?: string
}

export interface ProviderPoll {
  question: string
  answers: readonly string[]
  several: boolean
  ends?: number
  closed?: boolean
  counts: readonly number[]
  mine: readonly number[]
  voters?: Readonly<Record<string, readonly number[]>>
}

export interface LinkPreview {
  url: string
  title: string
  site?: string
  text?: string
  picture?: string
}

export type Delivery = 'sending' | 'sent' | 'delivered' | 'read' | 'failed'

export interface ProviderMessage {
  id: string
  conversation: string
  author: Person
  at: number
  text: string
  html?: string
  subject?: string
  attachments: readonly AttachmentRef[]
  mine: boolean
  replyTo?: string
  thread?: string
  replies?: number
  lastReplyAt?: number
  reactions?: Readonly<Record<string, readonly string[]>>
  editedAt?: number
  deleted?: boolean
  pinned?: boolean
  mentions?: readonly string[]
  poll?: ProviderPoll
  delivery?: Delivery
  preview?: LinkPreview
  forwarded?: boolean
  system?: boolean
  expiresAt?: number
}

export interface Page {
  messages: ProviderMessage[]
  before: string | null
}

export interface OutgoingFile {
  name: string
  type: string
  bytes: Uint8Array
  kind?: AttachmentKind
  width?: number
  height?: number
  seconds?: number
  wave?: readonly number[]
}

export interface Outgoing {
  text: string
  replyTo?: string
  thread?: string
  mentions?: readonly string[]
  attachments?: readonly OutgoingFile[]
  poll?: { question: string; answers: readonly string[]; several: boolean }
  sticker?: string
  broadcast?: boolean
}

export interface Sticker {
  ref: string
  name: string
  type: string
  emoji?: string
  width?: number
  height?: number
}

export interface StickerSet {
  id: string
  name: string
  stickers: readonly Sticker[]
}

export type Status = 'connecting' | 'online' | 'offline' | 'signed-out'

export type ProviderEvent =
  | { t: 'message'; message: ProviderMessage }
  | { t: 'conversation'; conversation: Conversation }
  | { t: 'conversations'; conversations: readonly Conversation[] }
  | { t: 'gone'; conversation: string }
  | { t: 'status'; status: Status; reason?: string }
  | { t: 'changed'; message: ProviderMessage }
  | { t: 'deleted'; conversation: string; message: string }
  | { t: 'typing'; conversation: string; person: string; on: boolean; thread?: string }
  | { t: 'presence'; person: string; online: boolean; lastSeen?: number }
  | { t: 'read'; conversation: string; person: string; upTo: string }

export interface Stream {
  write(bytes: Uint8Array): Promise<void>
  read(hear: (bytes: Uint8Array) => void, end: (reason?: string) => void): () => void
  close(): Promise<void>
}

export interface Socket extends Stream {
  startTls(): Promise<void>
}

export interface WireSocket {
  send(data: Uint8Array | string): Promise<void>
  read(hear: (data: Uint8Array | string) => void, end: (reason?: string) => void): () => void
  close(): Promise<void>
}

export interface WireAsk {
  url: string
  headers?: Readonly<Record<string, string>>
  protocols?: readonly string[]
}

export interface Prompt {
  kind: 'code' | 'password' | 'text' | 'phone'
  label: string
  note?: string
}

export type Screen =
  | { kind: 'qr'; data: string; label: string; note?: string }
  | { kind: 'wait'; label: string; note?: string }
  | { kind: 'link'; url: string; label: string; note?: string }

export interface Sealed {
  read(name: string): Promise<Uint8Array | null>
  write(name: string, bytes: Uint8Array | null): Promise<void>
}

export interface SocketAsk {
  host: string
  port: number
  tls: 'tls' | 'starttls' | 'none'
}

export interface Posted {
  status: number
  body: string
}

export interface NativeAsk {
  url: string
  method?: 'GET' | 'POST'
  bearer?: string
  type?: string
  body?: Uint8Array
}

export interface Host {
  secret(name: string): Promise<string | null>
  keepSecret(name: string, value: string | null): Promise<void>
  socket?: (ask: SocketAsk) => Promise<Socket>
  parseMessage?: (bytes: Uint8Array) => Promise<Parsed>
  fetch: typeof fetch
  now(): number
  ask?: (prompt: Prompt) => Promise<string>
  show?: (screen: Screen | null) => void
  whileWaiting?: (stop: () => void) => () => void
  sealed?: Sealed
  authorize?: (make: (loopback: string) => string) => Promise<Record<string, string>>
  post?: (url: string, form: Readonly<Record<string, string>>) => Promise<Posted>
  wire?: (ask: WireAsk) => Promise<WireSocket>
  sidecar?: (program: string, args: readonly string[]) => Promise<Stream>
  request?: (ask: NativeAsk) => Promise<Uint8Array>
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

export interface Account {
  id: string
  label: string
  self?: Person
  keep?: Readonly<Record<string, string>>
}

export interface HistoryAsk {
  limit: number
  before?: string
  around?: string
}

export interface Connection {
  readonly account: Account
  conversations(): Promise<Conversation[]>
  history(conversation: string, ask: HistoryAsk): Promise<Page>
  send(conversation: string, draft: Outgoing): Promise<ProviderMessage>
  start(hear: (event: ProviderEvent) => void): () => void
  attachment(conversation: string, message: string, ref: string): Promise<Uint8Array>
  markRead?(conversation: string, upTo: string): Promise<void>
  close(): Promise<void>
  thread?(conversation: string, parent: string, ask: HistoryAsk): Promise<Page>
  edit?(conversation: string, message: string, draft: Outgoing): Promise<void>
  remove?(conversation: string, message: string, everyone: boolean): Promise<void>
  react?(conversation: string, message: string, emoji: string, on: boolean): Promise<void>
  pin?(conversation: string, message: string, on: boolean): Promise<void>
  vote?(conversation: string, message: string, answers: readonly number[]): Promise<void>
  typing?(conversation: string, on: boolean, thread?: string): Promise<void>
  markUnread?(conversation: string): Promise<void>
  search?(query: string, conversation?: string): Promise<ProviderMessage[]>
  members?(conversation: string): Promise<Member[]>
  people?(query: string): Promise<Person[]>
  begin?(people: readonly string[], title?: string): Promise<Conversation>
  invite?(conversation: string, people: readonly string[]): Promise<void>
  kick?(conversation: string, person: string): Promise<void>
  promote?(conversation: string, person: string, role: ConversationRole): Promise<void>
  rename?(conversation: string, title: string): Promise<void>
  describe?(conversation: string, topic: string): Promise<void>
  leave?(conversation: string): Promise<void>
  mute?(conversation: string, until: number | null): Promise<void>
  archive?(conversation: string, on: boolean): Promise<void>
  pinConversation?(conversation: string, on: boolean): Promise<void>
  stickers?(): Promise<StickerSet[]>
  gifs?(query: string): Promise<Sticker[]>
  stickerBytes?(ref: string): Promise<Uint8Array>
  picture?(id: string): Promise<Uint8Array | null>
}

export interface Capabilities {
  send: boolean
  attachments: boolean
  live: boolean
  replies: boolean
  threads?: boolean
  editFor?: number
  removeFor?: number
  removeForMe?: boolean
  reactions?: 'any' | 'one' | readonly string[]
  voice?: boolean
  polls?: boolean
  receipts?: boolean
  presence?: boolean
  maxFile?: number
  formatting?: 'plain' | 'markdown' | 'mrkdwn' | 'html'
}

export interface ChatProvider {
  readonly id: string
  readonly name: string
  readonly icon: string
  readonly fields: readonly ConnectField[]
  readonly can: Capabilities
  readonly warning?: string
  readonly kept?: readonly string[]
  available(host: Host): boolean
  connect(
    config: Readonly<Record<string, string>>,
    host: Host,
    account?: string,
  ): Promise<Connection>
  forget?(account: string, host: Host): Promise<void>
}

export function secretName(provider: string, account: string, field: string): string {
  const clean = (part: string) => part.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 20)
  return `chat-${clean(provider)}_${hashed(account)}_${clean(field)}`
}

function hashed(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    a = Math.imul(a ^ code, 0x01000193) >>> 0
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0
  }
  return a.toString(36) + b.toString(36)
}

export function newestFirst(a: Conversation, b: Conversation): number {
  return (b.lastAt ?? 0) - (a.lastAt ?? 0)
}
