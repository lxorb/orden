import type { RoomKind } from '../src/sync-server/src/rooms/kind'
import { NoteRoom } from '../src/sync-server/src/rooms/room'
import type { Env } from '../src/sync-server/src/types'

class Pair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}
Object.assign(globalThis, { WebSocketRequestResponsePair: Pair })

export class FakeSocket {
  readonly sent: Uint8Array[] = []
  closed = false
  closedWith: { code?: number; reason?: string } | null = null
  private attachment: unknown = null

  send(data: Uint8Array | string) {
    if (typeof data !== 'string') this.sent.push(data)
  }

  close(code?: number, reason?: string) {
    this.closed = true
    this.closedWith = {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    }
  }

  serializeAttachment(value: unknown) {
    this.attachment = value
  }

  deserializeAttachment(): unknown {
    return this.attachment
  }

  take(): Uint8Array[] {
    return this.sent.splice(0, this.sent.length)
  }
}

export class FakeState {
  readonly kept = new Map<string, unknown>()
  private sockets: FakeSocket[] = []
  private alarm: number | null = null

  readonly storage = {
    get: (key: string): Promise<unknown> => Promise.resolve(this.kept.get(key)),
    list: (options: { prefix: string }): Promise<Map<string, unknown>> => {
      const found = new Map<string, unknown>()
      for (const [key, value] of this.kept) {
        if (key.startsWith(options.prefix)) found.set(key, value)
      }
      return Promise.resolve(found)
    },
    put: (first: string | Record<string, unknown>, second?: unknown): Promise<void> => {
      const entries = typeof first === 'string' ? { [first]: second } : first
      for (const [key, value] of Object.entries(entries)) this.kept.set(key, value)
      return Promise.resolve()
    },
    delete: (keys: string | string[]): Promise<number> => {
      let gone = 0
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        if (this.kept.delete(key)) gone++
      }
      return Promise.resolve(gone)
    },
    deleteAll: (): Promise<void> => {
      this.kept.clear()
      this.alarm = null
      return Promise.resolve()
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

  takeAlarm(): number | null {
    const at = this.alarm
    this.alarm = null
    return at
  }

  autoResponse: Pair | null = null

  setWebSocketAutoResponse(pair: Pair) {
    this.autoResponse = pair
  }

  acceptWebSocket(socket: FakeSocket) {
    this.sockets.push(socket)
  }

  getWebSockets(): FakeSocket[] {
    return this.sockets
  }

  drop(socket: FakeSocket) {
    this.sockets = this.sockets.filter((one) => one !== socket)
  }

  blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T> {
    return work()
  }

  aborted: string | null = null

  abort(reason?: string) {
    this.aborted = reason ?? ''
  }

  waitUntil(work: Promise<unknown>) {
    this.pending.push(work)
  }

  private readonly pending: Promise<unknown>[] = []

  async idle(): Promise<void> {
    while (this.pending.length) await Promise.all(this.pending.splice(0, this.pending.length))
  }
}

export function room(env: Env): { room: NoteRoom; state: FakeState } {
  const state = new FakeState()
  const made = new NoteRoom(state as unknown as DurableObjectState, env)
  return { room: made, state }
}

export async function join(
  made: NoteRoom,
  note: { id: string; spaceId: string; kind?: RoomKind; who?: string },
  writes = true,
): Promise<FakeSocket> {
  const socket = new FakeSocket()
  await made.enter(
    socket as unknown as WebSocket,
    { noteId: note.id, spaceId: note.spaceId, kind: note.kind ?? 'words' },
    { writes, who: note.who ?? '' },
  )
  return socket
}

export function running(env: Env): {
  ROOMS: DurableObjectNamespace
  of(noteId: string): { room: NoteRoom; state: FakeState }
  all(): ReadonlyMap<string, { room: NoteRoom; state: FakeState }>
} {
  const made = new Map<string, { room: NoteRoom; state: FakeState }>()

  const of = (noteId: string) => {
    let held = made.get(noteId) ?? room(env)
    if (held.state.aborted !== null) {
      held.state.aborted = null
      held = {
        room: new NoteRoom(held.state as unknown as DurableObjectState, env),
        state: held.state,
      }
    }
    made.set(noteId, held)
    return held
  }

  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (request: Request) => of(String(id)).room.fetch(request),
    }),
  }

  return { ROOMS: namespace as unknown as DurableObjectNamespace, of, all: () => made }
}

export function doorway(failing = 0): { ROOMS: DurableObjectNamespace; asked: Headers[] } {
  const asked: Headers[] = []
  let left = failing

  const stub = {
    fetch: (request: Request) => {
      asked.push(request.headers)
      if (left-- > 0) {
        return Promise.reject(new Error('Durable Object reset because its code was updated.'))
      }

      return Promise.resolve(new Response(null, { status: 200 }))
    },
  }

  const namespace = {
    idFromName: () => 'one',
    get: () => stub,
  }

  return { ROOMS: namespace as unknown as DurableObjectNamespace, asked }
}

export async function say(
  made: NoteRoom,
  state: FakeState,
  socket: FakeSocket,
  message: Uint8Array,
): Promise<void> {
  await made.webSocketMessage(socket as unknown as WebSocket, message.slice().buffer)
  await state.idle()
}
