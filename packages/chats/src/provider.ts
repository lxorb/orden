import type { Parsed } from './mail/mime'

export type ConversationKind = 'direct' | 'group' | 'channel' | 'thread'

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
  handle?: string
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
  messages: ProviderMessage[]
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

export interface Socket {
  write(bytes: Uint8Array): Promise<void>
  read(hear: (bytes: Uint8Array) => void, end: (reason?: string) => void): () => void
  startTls(): Promise<void>
  close(): Promise<void>
}

export interface SocketAsk {
  host: string
  port: number
  tls: 'tls' | 'starttls' | 'none'
}

export interface Host {
  secret(name: string): Promise<string | null>
  keepSecret(name: string, value: string | null): Promise<void>
  socket?: (ask: SocketAsk) => Promise<Socket>
  parseMessage?: (bytes: Uint8Array) => Promise<Parsed>
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
  readonly id: string
  readonly name: string
  readonly icon: string
  readonly fields: readonly ConnectField[]
  readonly can: Capabilities
  available(host: Host): boolean
  connect(config: Readonly<Record<string, string>>, host: Host): Promise<Connection>
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
