import type { tl } from '@mtcute/core'

export type ClientState = 'offline' | 'connecting' | 'online' | 'signed-out'

export interface Found {
  users: readonly tl.TypeUser[]
  chats: readonly tl.TypeChat[]
}

export interface SentCode {
  hash: string
  via: 'app' | 'sms' | 'call' | 'other'
}

export interface Client {
  call<T extends tl.RpcMethod>(request: T): Promise<tl.RpcCallReturn[T['_']]>
  listen(
    update: (update: tl.TypeUpdate, found: Found) => void,
    state: (state: ClientState) => void,
  ): () => void
  sendCode(phone: string): Promise<SentCode | tl.RawUser>
  signIn(phone: string, hash: string, code: string): Promise<tl.RawUser>
  checkPassword(password: string): Promise<tl.RawUser>
  hint(): Promise<string | null>
  signInQr(
    show: (url: string, expires: number) => void,
    password: () => Promise<string>,
    wrong: () => void,
  ): Promise<tl.RawUser>
  ready(me: tl.RawUser): Promise<void>
  session(): Promise<string>
  download(location: tl.TypeInputFileLocation, dc: number, size?: number): Promise<Uint8Array>
  upload(bytes: Uint8Array, name: string, type: string): Promise<tl.TypeInputFile>
  logOut(): Promise<void>
  close(): Promise<void>
}

export interface Setup {
  apiId: number
  apiHash: string
  session: string | null
}

export type Dial = (setup: Setup) => Promise<Client>

const GONE = new Set([
  'AUTH_KEY_UNREGISTERED',
  'AUTH_KEY_INVALID',
  'AUTH_KEY_DUPLICATED',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
])

export function errorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'text' in error) {
    const text = error.text
    if (typeof text === 'string') return text
  }
  return error instanceof Error ? error.message : String(error)
}

export function signedOut(error: unknown): boolean {
  return GONE.has(errorText(error))
}
