import type { SpaceFile } from './spaces/files'
import type { Env, Note, Space } from './types'

export interface Ended {
  machine: string
  session: string
  user_id: string
}

type RevokedRole = 'none' | 'read'

interface BlogHooks {
  publishesFile(env: Env, space: Space, file: SpaceFile, request: Request): Promise<boolean>
}

interface ChatHooks {
  askChat(
    env: Env,
    chat: string,
    ask: 'held-files' | 'profile',
    headers?: Record<string, string>,
  ): Promise<Response | null>
  chatsRevoked(
    env: Env,
    spaceId: string,
    who: string,
    role: RevokedRole,
    item?: string,
  ): Promise<void>
  closeChats(env: Env, open: readonly { chat_id: string; who: string }[]): Promise<void>
  eraseChats(env: Env, chats: readonly string[]): Promise<string[]>
  linkPointer(env: Env, note: Note, content: string): Promise<void>
}

interface MachineHooks {
  eraseMachines(env: Env, ids: readonly string[]): Promise<string[]>
  endTerms(env: Env, terms: readonly string[], who: string | null): Promise<void>
  endingTerm(env: Env, term: string, at: number): D1PreparedStatement
  tellEnded(env: Env, ended: readonly Ended[], who: string | null): Promise<void>
  machinesRevoked(
    env: Env,
    spaceId: string,
    who: string | null,
    role: RevokedRole,
    item?: string,
  ): Promise<void>
  machinesSignedOut(env: Env, who: string, logins: readonly string[]): Promise<void>
}

interface PassHooks {
  erased: readonly (readonly [table: string, sql: string])[]
}

export interface Hooks {
  blog: BlogHooks
  chats: ChatHooks
  machines: MachineHooks
  pass: PassHooks
}

let wired: Hooks | null = null

export function wire(hooks: Hooks): void {
  wired = hooks
}

export function hooks(): Hooks {
  if (!wired) throw new Error('sync-server: wire the blog, chats, machines and pass hooks first')
  return wired
}
