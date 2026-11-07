import { vi } from 'vitest'
import { sha256 } from '../src/crypto'
import { AccountHub, type Joining } from '../src/hub/hub'
import type { FromHub } from '../src/hub/frames'
import type { Env } from '../src/types'
import { signIn, type TestEnv } from './harness'

class Pair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}
Object.assign(globalThis, { WebSocketRequestResponsePair: Pair })

export class HubSocket {
  readonly said: FromHub[] = []
  readyState = 1
  closedWith: { code: number | undefined; reason: string | undefined } | null = null
  private attachment: unknown = null

  constructor(readonly tags: string[] = []) {}

  send(data: string) {
    this.said.push(JSON.parse(data) as FromHub)
  }

  close(code?: number, reason?: string) {
    this.readyState = 3
    this.closedWith = { code, reason }
  }

  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value)
  }

  deserializeAttachment(): unknown {
    return structuredClone(this.attachment)
  }

  take(): FromHub[] {
    return this.said.splice(0, this.said.length)
  }
}

export class HubState {
  readonly kept = new Map<string, unknown>()
  private sockets: HubSocket[] = []
  alarm: number | null = null
  autoResponse: Pair | null = null

  readonly storage = {
    get: (key: string | string[]): Promise<unknown> =>
      Promise.resolve(
        Array.isArray(key)
          ? new Map(key.filter((one) => this.kept.has(one)).map((one) => [one, this.copy(one)]))
          : this.copy(key),
      ),
    put: (first: string | Record<string, unknown>, second?: unknown): Promise<void> => {
      const entries = typeof first === 'string' ? { [first]: second } : first
      for (const [key, value] of Object.entries(entries)) {
        this.kept.set(key, structuredClone(value))
      }
      return Promise.resolve()
    },
    delete: (keys: string | string[]): Promise<boolean | number> => {
      if (typeof keys === 'string') return Promise.resolve(this.kept.delete(keys))
      return Promise.resolve(keys.filter((key) => this.kept.delete(key)).length)
    },
    deleteAll: (): Promise<void> => {
      this.kept.clear()
      this.alarm = null
      return Promise.resolve()
    },
    list: (options: { prefix: string }): Promise<Map<string, unknown>> => {
      const found = new Map<string, unknown>()
      for (const key of [...this.kept.keys()].sort()) {
        if (key.startsWith(options.prefix)) found.set(key, this.copy(key))
      }
      return Promise.resolve(found)
    },
    getAlarm: (): Promise<number | null> => Promise.resolve(this.alarm),
    setAlarm: (at: number): Promise<void> => {
      this.alarm = at
      return Promise.resolve()
    },
    deleteAlarm: (): Promise<void> => {
      this.alarm = null
      return Promise.resolve()
    },
  }

  private copy(key: string): unknown {
    const value = this.kept.get(key)
    return value === undefined ? undefined : structuredClone(value)
  }

  setWebSocketAutoResponse(pair: Pair) {
    this.autoResponse = pair
  }

  acceptWebSocket(socket: HubSocket, tags: string[] = []) {
    socket.tags.push(...tags)
    this.sockets.push(socket)
  }

  getWebSockets(tag?: string): HubSocket[] {
    return this.sockets.filter((one) => tag === undefined || one.tags.includes(tag))
  }

  getTags(socket: HubSocket): string[] {
    return socket.tags
  }

  drop(socket: HubSocket) {
    this.sockets = this.sockets.filter((one) => one !== socket)
  }

  blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T> {
    return work()
  }

  waitUntil(work: Promise<unknown>) {
    void work
  }
}

export function hub(env: Env): { hub: AccountHub; state: HubState } {
  const state = new HubState()
  const made = new AccountHub(state as unknown as DurableObjectState, env)
  return { hub: made, state }
}

export function hubs(env: Env): {
  HUB: DurableObjectNamespace
  of(id: string): { hub: AccountHub; state: HubState }
  asked: { id: string; ask: string; headers: Headers }[]
} {
  const made = new Map<string, { hub: AccountHub; state: HubState }>()
  const asked: { id: string; ask: string; headers: Headers }[] = []

  const of = (id: string) => {
    const held = made.get(id) ?? hub(env)
    made.set(id, held)
    return held
  }

  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (request: Request) => {
        asked.push({
          id: String(id),
          ask: request.headers.get('x-orden-hub') ?? '',
          headers: request.headers,
        })
        return of(String(id)).hub.fetch(request)
      },
    }),
  }

  return { HUB: namespace as unknown as DurableObjectNamespace, of, asked }
}

export function connect(
  made: AccountHub,
  joining: Partial<Joining> & { device: string; who: string },
): HubSocket {
  const socket = new HubSocket()
  made.enter(socket as unknown as WebSocket, {
    session: '',
    guest: false,
    ...joining,
  })
  return socket
}

export async function send(made: AccountHub, socket: HubSocket, frame: unknown): Promise<void> {
  await made.webSocketMessage(
    socket as unknown as WebSocket,
    typeof frame === 'string' ? frame : JSON.stringify(frame),
  )
}

export async function hangUp(made: AccountHub, state: HubState, socket: HubSocket) {
  socket.readyState = 3
  await made.webSocketClose(socket as unknown as WebSocket)
  state.drop(socket)
}

export type Hubs = ReturnType<typeof hubs>

export interface Computer {
  token: string
  id: string
  user: string
  session: string
  socket: HubSocket
}

export async function computer(
  env: TestEnv,
  running: Hubs,
  email: string,
  name: string,
): Promise<Computer> {
  const token = await signIn(env, email)
  const user = (env.db.prepare('select id from users where email = ?').get(email) as { id: string })
    .id
  const session = (
    env.db.prepare('select id from sessions where token_hash = ?').get(await sha256(token)) as {
      id: string
    }
  ).id

  const id = `device-${name.toLowerCase()}`
  const { hub: made } = running.of(user)
  const socket = connect(made, { device: id, who: user, session })
  await send(made, socket, { t: 'hello', device: id, name, platform: 'windows', app: '1.0.0' })

  vi.setSystemTime(Date.now() + 31_000)
  socket.take()
  return { token, id, user, session, socket }
}
