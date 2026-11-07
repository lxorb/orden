import type {
  AnyMessageContent,
  AuthenticationCreds,
  BaileysEventMap,
  ChatModification,
  GroupMetadata,
  MiscMessageGenerationOptions,
  ParticipantAction,
  SignalKeyStore,
  WAMessage,
  WAMessageKey,
  WAPresence,
  proto,
} from '@whiskeysockets/baileys'
import type { WireAsk, WireSocket } from '../provider'
import type { MediaConn } from './media'

export type Events = BaileysEventMap

export interface Setup {
  creds: AuthenticationCreds
  keys: SignalKeyStore
  message(key: WAMessageKey): Promise<proto.IMessage | undefined>
}

export interface Link {
  on<E extends keyof Events>(event: E, hear: (data: Events[E]) => void): void
  pairingCode(phone: string): Promise<string>
  send(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Promise<WAMessage | undefined>
  relay(jid: string, message: proto.IMessage): Promise<WAMessage>
  mediaConn(): Promise<MediaConn>
  reupload(message: WAMessage): Promise<WAMessage>
  modify(change: ChatModification, jid: string): Promise<void>
  read(keys: WAMessageKey[]): Promise<void>
  presence(kind: WAPresence, jid?: string): Promise<void>
  subscribe(jid: string): Promise<void>
  group(jid: string): Promise<GroupMetadata>
  groups(): Promise<Record<string, GroupMetadata>>
  participants(jid: string, people: string[], action: ParticipantAction): Promise<void>
  subject(jid: string, text: string): Promise<void>
  description(jid: string, text: string): Promise<void>
  leave(jid: string): Promise<void>
  picture(jid: string): Promise<string | undefined>
  exists(phone: string): Promise<string | null>
  older(count: number, oldest: WAMessageKey, at: number): Promise<void>
  create(subject: string, people: string[]): Promise<GroupMetadata>
  logOut(): Promise<void>
  close(): void
}

export interface Vote {
  name: string
  voters: string[]
}

export interface Kit {
  dial(setup: Setup): Link
  fresh(): AuthenticationCreds
  bytes(data: Uint8Array): Uint8Array
  revive(type: string, value: unknown): unknown
  encode(message: WAMessage): Uint8Array
  decode(bytes: Uint8Array): WAMessage
  votes(message: WAMessage, me: string): Vote[]
  vote(
    poll: WAMessage,
    names: readonly string[],
    me: string,
  ): { message: proto.IMessage; selected: Uint8Array[] }
}

export type Load = (wire: (ask: WireAsk) => Promise<WireSocket>) => Promise<Kit>

export const LOGGED_OUT = 401
export const RESTART = 515
export const REPLACED = 440
export const TIMED_OUT = 408
export const FORBIDDEN = 403
export const OUTDATED = 405

export function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const output = (error as { output?: { statusCode?: unknown } }).output
  return typeof output?.statusCode === 'number' ? output.statusCode : null
}
