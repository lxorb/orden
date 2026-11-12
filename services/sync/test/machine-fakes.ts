import type { MachineHost } from '@orden/online'
import { linkFrame, type MachineFrame, type OrdendFrame } from '@orden/online/wire'
import { unframe } from '@orden/sync-core'
import { Machine, type Viewer } from '../src/machines/machine'
import type { Env } from '../src/types'
import { HubState } from './hub-fakes'

class FakeLink {
  readonly sent: MachineFrame[] = []
  onSleep: (() => void) | null = null
  silent = false
  closed = false
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  send(bytes: Uint8Array) {
    const frame = unframe(bytes) as MachineFrame
    this.sent.push(frame)
    if (frame.t === 'sleep') queueMicrotask(() => this.onSleep?.())
    if (frame.t === 'ping' && !this.silent) queueMicrotask(() => this.say({ t: 'pong' }))
  }

  say(frame: OrdendFrame) {
    const bytes = linkFrame(frame)
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    for (const one of this.listeners.get('message') ?? []) one({ data })
  }

  addEventListener(kind: string, listener: (event: unknown) => void) {
    this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), listener])
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const one of this.listeners.get('close') ?? []) one({})
  }

  take(): MachineFrame[] {
    return this.sent.splice(0, this.sent.length)
  }
}

class FakeHost implements MachineHost {
  readonly calls: string[] = []
  up = false
  link_: FakeLink | null = null
  onSleep: (() => void) | null = null
  snapshots = 0
  backups = 0
  failStart = false
  failLinks = 0
  failBackup: Error | null = null
  hangRestore = false
  alwaysOn = false

  reboot(): Promise<void> {
    this.calls.push('reboot')
    return Promise.resolve()
  }

  remove(): Promise<void> {
    this.calls.push('remove')
    return Promise.resolve()
  }

  start(_id: string, image: string): Promise<void> {
    this.calls.push(`start ${image}`)
    if (this.failStart) {
      this.failStart = false
      return Promise.reject(new Error('no room'))
    }
    this.up = true
    return Promise.resolve()
  }

  stop(): Promise<void> {
    this.calls.push('stop')
    this.up = false
    return Promise.resolve()
  }

  running(): Promise<boolean> {
    return Promise.resolve(this.up)
  }

  link(): Promise<WebSocket> {
    this.calls.push('link')
    if (this.failLinks > 0) {
      this.failLinks -= 1
      return Promise.reject(new Error('ordend answered 401'))
    }
    this.link_ = new FakeLink()
    this.link_.onSleep = this.onSleep
    return Promise.resolve(this.link_ as unknown as WebSocket)
  }

  snapshot(): Promise<string> {
    this.calls.push('snapshot')
    return Promise.resolve(`snap-${String(++this.snapshots)}`)
  }

  backup(_id: string, dir: string): Promise<string> {
    this.calls.push(`backup ${dir}`)
    const failure = this.failBackup
    this.failBackup = null
    if (failure) return Promise.reject(failure)
    const id = `backup-${String(++this.backups)}`
    return Promise.resolve(JSON.stringify({ id, key: `${id}.tar.zst` }))
  }

  restore(_id: string, from: { snapshot?: string; backup?: string }): Promise<void> {
    this.calls.push(
      from.snapshot ? `restore snapshot ${from.snapshot}` : `restore backup ${from.backup ?? ''}`,
    )
    if (from.backup && this.hangRestore) return new Promise<void>(() => undefined)
    return Promise.resolve()
  }

  usage(): Promise<{ cpuS: number; egressBytes: number }> {
    return Promise.resolve({ cpuS: 0, egressBytes: 0 })
  }
}

export class MachineSocket {
  readonly said: { t: string; [key: string]: unknown }[] = []
  readonly bytes: Uint8Array[] = []
  readyState = 1
  closedWith: { code: number | undefined; reason: string | undefined } | null = null
  beatAt: Date | null = null
  readonly tags: string[] = []
  private attachment: unknown = null

  send(data: string | Uint8Array) {
    if (typeof data === 'string') this.said.push(JSON.parse(data) as { t: string })
    else this.bytes.push(data)
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

  of(t: string) {
    return this.said.filter((one) => one.t === t)
  }
}

export interface Running {
  machine: Machine
  state: HubState
  host: FakeHost
}

export async function machine(env: Env, id: string, user: string): Promise<Running> {
  const state = new HubState()
  Object.assign(state, {
    getWebSocketAutoResponseTimestamp: (socket: MachineSocket) => socket.beatAt,
  })
  const host = new FakeHost()
  const made = new Machine(state as unknown as DurableObjectState, env, host)
  host.onSleep = () => void made.fromOrdend({ t: 'saved' })
  await made.fetch(
    new Request('https://machine.invalid/state', {
      headers: { 'x-orden-machine': 'state', 'x-orden-id': id, 'x-orden-user': user },
    }),
  )
  return { machine: made, state, host }
}

export async function join(
  running: Running,
  viewer: Partial<Viewer> & { who: string },
  wake = 'no',
): Promise<MachineSocket> {
  const socket = new MachineSocket()
  await running.machine.enter(
    socket as unknown as WebSocket,
    {
      device: `device-${viewer.who}`,
      term: 'term-1',
      session: 'session-1',
      guest: false,
      role: 'read',
      owns: false,
      typing: 'owner',
      cols: 80,
      rows: 24,
      seen: Date.now(),
      ...viewer,
    },
    wake,
  )
  return socket
}

export async function say(running: Running, socket: MachineSocket, frame: unknown) {
  await running.machine.webSocketMessage(
    socket as unknown as WebSocket,
    typeof frame === 'string' ? frame : JSON.stringify(frame),
  )
}

export async function ordend(running: Running, frame: OrdendFrame) {
  await running.machine.fromOrdend(frame)
}

export async function fire(running: Running): Promise<boolean> {
  const { state } = running
  if (state.alarm === null || state.alarm > Date.now()) return false
  state.alarm = null
  await running.machine.alarm()
  return true
}

export function doorway(): {
  MACHINES: DurableObjectNamespace
  asked: { id: string; headers: Headers }[]
  answers: Map<string, unknown>
} {
  const asked: { id: string; headers: Headers }[] = []
  const answers = new Map<string, unknown>()
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({
      fetch: (request: Request) => {
        asked.push({ id: String(id), headers: request.headers })
        const ask = request.headers.get('x-orden-machine') ?? ''
        return Promise.resolve(Response.json(answers.get(ask) ?? { state: 'asleep' }))
      },
    }),
  }
  return { MACHINES: namespace as unknown as DurableObjectNamespace, asked, answers }
}
