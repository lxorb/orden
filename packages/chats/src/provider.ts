/** A chat service Orden can connect to (#321): Orden's own chats, mail, and any other.
 *  Everything a provider needs from Orden is the `Host` it is handed; everything Orden
 *  needs from a provider is below. Nothing else of Orden is imported. */

export type ConversationKind = 'direct' | 'group' | 'channel' | 'thread'

/** One question connecting asks; `secret` values go to the vault, the rest to settings. */
export interface ConnectField {
  key: string
  label: string
  kind: 'text' | 'email' | 'password' | 'number' | 'select'
  secret?: boolean
  optional?: boolean
  initial?: string
  placeholder?: string
  options?: readonly { value: string; label: string }[]
}

export interface Person {
  id: string
  name: string
  /** An address or a number the person can be found by. */
  handle?: string
}

export interface Conversation {
  id: string
  title: string | null
  kind: ConversationKind
  people: readonly Person[]
  /** When its newest message arrived, ms. */
  lastAt: number | null
  unread: number
  mentions?: number
  mutedUntil?: number | null
  /** Its newest words, one line. */
  snippet?: string
}

export interface AttachmentRef {
  ref: string
  name: string
  type: string
  size: number
}

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
}

export interface Page {
  /** Oldest first. */
  messages: ProviderMessage[]
  /** Pass as `before` for the page older than this one; null at the first message. */
  before: string | null
}

export interface Outgoing {
  text: string
  replyTo?: string
  attachments?: readonly { name: string; type: string; bytes: Uint8Array }[]
}

export type Status = 'connecting' | 'online' | 'offline' | 'signed-out'

export type ProviderEvent =
  | { t: 'message'; message: ProviderMessage }
  | { t: 'conversation'; conversation: Conversation }
  | { t: 'conversations'; conversations: readonly Conversation[] }
  | { t: 'gone'; conversation: string }
  | { t: 'status'; status: Status; reason?: string }

/** A byte stream to a server, TLS or plain, upgraded in place for STARTTLS. */
export interface Socket {
  write(bytes: Uint8Array): Promise<void>
  /** Hears every chunk that arrives, then `end` once. Answers how to stop. */
  read(hear: (bytes: Uint8Array) => void, end: (reason?: string) => void): () => void
  startTls(): Promise<void>
  close(): Promise<void>
}

export interface SocketAsk {
  host: string
  port: number
  tls: 'tls' | 'starttls' | 'none'
}

/** What Orden lends a provider. */
export interface Host {
  secret(name: string): Promise<string | null>
  keepSecret(name: string, value: string | null): Promise<void>
  /** Absent where the platform cannot open one (a browser). */
  socket?: (ask: SocketAsk) => Promise<Socket>
  fetch: typeof fetch
  now(): number
}

export interface Account {
  id: string
  label: string
}

export interface Connection {
  readonly account: Account
  conversations(): Promise<Conversation[]>
  history(conversation: string, ask: { limit: number; before?: string }): Promise<Page>
  send(conversation: string, draft: Outgoing): Promise<ProviderMessage>
  /** Live: answers how to stop. */
  start(hear: (event: ProviderEvent) => void): () => void
  attachment(conversation: string, message: string, ref: string): Promise<Uint8Array>
  markRead?(conversation: string, upTo: string): Promise<void>
  close(): Promise<void>
}

export interface Capabilities {
  send: boolean
  attachments: boolean
  live: boolean
  replies: boolean
}

export interface ChatProvider {
  /** Letters, digits and `-`: part of every vault name it keeps. */
  readonly id: string
  readonly name: string
  /** One SVG path in a 24 by 24 box. */
  readonly icon: string
  readonly fields: readonly ConnectField[]
  readonly can: Capabilities
  /** Whether this platform can run it at all. */
  available(host: Host): boolean
  /** `config` holds every field's value, secrets included. */
  connect(config: Readonly<Record<string, string>>, host: Host): Promise<Connection>
}

/** The vault name a provider account's secret is kept under. */
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

/** Conversations newest first; a stable sort keeps ties where they were. */
export function newestFirst(a: Conversation, b: Conversation): number {
  return (b.lastAt ?? 0) - (a.lastAt ?? 0)
}
