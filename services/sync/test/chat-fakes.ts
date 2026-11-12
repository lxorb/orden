import { DatabaseSync } from 'node:sqlite'
import type { ServerFrame } from '@orden/chats/wire'
import { ChatLog, type Person } from '../src/sync-server-chats/src/chats/log'
import type { Env } from '../src/sync-server/src/types'

class Pair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}
Object.assign(globalThis, { WebSocketRequestResponsePair: Pair })

class Cursor<T> {
  constructor(private readonly rows: T[]) {}

  toArray(): T[] {
    return this.rows
  }

  one(): T {
    if (this.rows.length !== 1) throw new Error(`expected one row, got ${this.rows.length}`)
    return this.rows[0] as T
  }

  [Symbol.iterator]() {
    return this.rows[Symbol.iterator]()
  }
}

class Sql {
  constructor(private readonly db: () => DatabaseSync) {}

  exec(query: string, ...bindings: (string | number | null)[]) {
    const db = this.db()
    if (!bindings.length && /^\s*create /i.test(query) && query.trim().includes(';')) {
      db.exec(query)
      return new Cursor([])
    }
    return new Cursor(db.prepare(query).all(...bindings) as Record<string, unknown>[])
  }
}

export class ChatSocket {
  readonly said: ServerFrame[] = []
  closedWith: { code: number | undefined; reason: string | undefined } | null = null
  private attachment: unknown = null

  constructor(readonly tags: string[] = []) {}

  send(data: string) {
    this.said.push(JSON.parse(data) as ServerFrame)
  }

  close(code?: number, reason?: string) {
    this.closedWith = { code, reason }
  }

  get closed(): boolean {
    return this.closedWith !== null
  }

  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value)
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment)
  }

  take(): ServerFrame[] {
    return this.said.splice(0, this.said.length)
  }

  takeOf<T extends ServerFrame['t']>(t: T): Extract<ServerFrame, { t: T }>[] {
    return this.take().filter((one): one is Extract<ServerFrame, { t: T }> => one.t === t)
  }
}

class ChatState {
  private database = new DatabaseSync(':memory:')
  private sockets: ChatSocket[] = []
  alarm: number | null = null

  readonly storage = {
    sql: new Sql(() => this.database),
    transactionSync: <T>(work: () => T): T => {
      this.database.exec('begin')
      try {
        const done = work()
        this.database.exec('commit')
        return done
      } catch (error) {
        this.database.exec('rollback')
        throw error
      }
    },
    getAlarm: () => Promise.resolve(this.alarm),
    setAlarm: (at: number) => {
      this.alarm = at
      return Promise.resolve()
    },
    deleteAlarm: () => {
      this.alarm = null
      return Promise.resolve()
    },
    deleteAll: () => {
      this.database.close()
      this.database = new DatabaseSync(':memory:')
      this.alarm = null
      return Promise.resolve()
    },
  }

  get db(): DatabaseSync {
    return this.database
  }

  setWebSocketAutoResponse(_pair: Pair) {
    return undefined
  }

  acceptWebSocket(socket: ChatSocket, tags: string[] = []) {
    socket.tags.push(...tags)
    this.sockets.push(socket)
  }

  getWebSockets(tag?: string): ChatSocket[] {
    return this.sockets.filter((one) => tag === undefined || one.tags.includes(tag))
  }

  drop(socket: ChatSocket) {
    this.sockets = this.sockets.filter((one) => one !== socket)
  }

  waitUntil(work: Promise<unknown>) {
    this.pending.push(work)
  }

  private readonly pending: Promise<unknown>[] = []

  async idle(): Promise<void> {
    while (this.pending.length) await Promise.all(this.pending.splice(0, this.pending.length))
  }

  blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T> {
    return work()
  }
}

export interface Held {
  log: ChatLog
  state: ChatState
}

export function chatLogs(env: Env): {
  CHATS: DurableObjectNamespace
  of(chat: string): Held
  asked: { chat: string; ask: string; headers: Headers }[]
} {
  const made = new Map<string, Held>()
  const asked: { chat: string; ask: string; headers: Headers }[] = []

  const of = (chat: string) => {
    const held =
      made.get(chat) ??
      (() => {
        const state = new ChatState()
        return { log: new ChatLog(state as unknown as DurableObjectState, env), state }
      })()
    made.set(chat, held)
    return held
  }

  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (request: Request) => {
        asked.push({
          chat: String(id),
          ask: request.headers.get('x-orden-chat-ask') ?? '',
          headers: request.headers,
        })
        return of(String(id)).log.fetch(request)
      },
    }),
  }
  return { CHATS: namespace as unknown as DurableObjectNamespace, of, asked }
}

export async function open(
  held: Held,
  person: Person,
  where: { chat: string; space: string },
  since?: number,
  login?: string,
): Promise<ChatSocket> {
  await held.log.fetch(
    new Request('https://chats.invalid/', {
      headers: {
        'x-orden-chat-ask': 'events',
        'x-orden-chat': where.chat,
        'x-orden-space': where.space,
      },
    }),
  )
  const socket = new ChatSocket()
  await held.log.enter(socket as unknown as WebSocket, person, login)
  await say(held, socket, since === undefined ? { t: 'hello' } : { t: 'hello', since })
  return socket
}

export async function say(held: Held, socket: ChatSocket, frame: unknown): Promise<void> {
  await held.log.webSocketMessage(
    socket as unknown as WebSocket,
    typeof frame === 'string' ? frame : JSON.stringify(frame),
  )
}

export async function hangUp(held: Held, socket: ChatSocket): Promise<void> {
  socket.closedWith = { code: 1000, reason: undefined }
  await held.log.webSocketClose(socket as unknown as WebSocket)
  held.state.drop(socket)
}

export async function fire(held: Held): Promise<boolean> {
  const at = held.state.alarm
  if (at === null || at > Date.now()) return false
  held.state.alarm = null
  await held.log.alarm()
  return true
}
