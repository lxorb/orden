import type { Host, Stream } from '../provider'

const PROGRAM = 'signal-cli'
const ARGS = ['jsonRpc', '--receive-mode=manual', '--ignore-stories'] as const

class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

export class Ended extends Error {}

export interface Notice {
  method: string
  params: unknown
}

interface Waiting {
  resolve(value: unknown): void
  reject(error: Error): void
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function ascii(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

export class Rpc {
  private next = 0
  private readonly tag = Math.random().toString(36).slice(2, 8)
  private readonly waiting = new Map<string, Waiting>()
  private readonly listeners = new Set<(notice: Notice) => void>()
  private readonly enders = new Set<(reason: string) => void>()
  private readonly decoder = new TextDecoder()
  private rest = ''
  private stop: () => void
  ended: string | null = null

  constructor(private readonly stream: Stream) {
    this.stop = stream.read(
      (bytes) => this.heard(bytes),
      (reason) => this.end(reason ?? 'signal-cli stopped'),
    )
  }

  private heard(bytes: Uint8Array): void {
    this.rest += this.decoder.decode(bytes, { stream: true })
    let at = this.rest.indexOf('\n')
    while (at !== -1) {
      const line = this.rest.slice(0, at).trim()
      this.rest = this.rest.slice(at + 1)
      if (line) this.line(line)
      at = this.rest.indexOf('\n')
    }
  }

  private line(line: string): void {
    let said: unknown
    try {
      said = JSON.parse(line)
    } catch {
      return
    }
    const message = record(said)
    if (!message) return
    if (typeof message.method === 'string') {
      const notice = { method: message.method, params: message.params }
      for (const listener of [...this.listeners]) listener(notice)
      return
    }
    const id = typeof message.id === 'string' ? message.id : null
    const waiting = id === null ? undefined : this.waiting.get(id)
    if (!waiting || id === null) return
    this.waiting.delete(id)
    const error = record(message.error)
    if (error) {
      const text = typeof error.message === 'string' ? error.message : 'signal-cli refused'
      waiting.reject(
        new RpcError(text, typeof error.code === 'number' ? error.code : 0, error.data),
      )
    } else waiting.resolve(message.result ?? null)
  }

  private end(reason: string): void {
    if (this.ended !== null) return
    this.ended = reason
    for (const one of this.waiting.values()) one.reject(new Ended(reason))
    this.waiting.clear()
    for (const ender of [...this.enders]) ender(reason)
  }

  call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.ended !== null) return Promise.reject(new Ended(this.ended))
    const id = `${this.tag}-${++this.next}`
    const body = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }
    return new Promise<unknown>((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.stream.write(new TextEncoder().encode(`${ascii(body)}\n`)).catch((error: unknown) => {
        this.waiting.delete(id)
        reject(error instanceof Error ? error : new Ended(String(error)))
      })
    })
  }

  hear(listener: (notice: Notice) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onEnd(ender: (reason: string) => void): () => void {
    this.enders.add(ender)
    return () => this.enders.delete(ender)
  }

  async close(): Promise<void> {
    this.stop()
    this.end('closed')
    await this.stream.close().catch(() => undefined)
  }
}

interface Shared {
  rpc: Promise<Rpc>
  users: number
}

const shared = new WeakMap<Host, Shared>()

export async function borrow(host: Host): Promise<Rpc> {
  const start = host.sidecar
  if (!start) throw new Error('Signal needs Orden on a computer')
  let one = shared.get(host)
  if (one) {
    const rpc = await one.rpc.catch(() => null)
    if (rpc?.ended !== null) {
      if (shared.get(host) === one) shared.delete(host)
      one = undefined
    }
  }
  if (!one) {
    const made: Shared = {
      rpc: start(PROGRAM, ARGS).then((stream) => new Rpc(stream)),
      users: 0,
    }
    made.rpc.catch(() => {
      if (shared.get(host) === made) shared.delete(host)
    })
    shared.set(host, made)
    one = made
  }
  one.users += 1
  try {
    return await one.rpc
  } catch (error) {
    one.users -= 1
    throw error
  }
}

export async function giveBack(host: Host, rpc: Rpc): Promise<void> {
  const one = shared.get(host)
  if (!one || (await one.rpc.catch(() => null)) !== rpc) return
  one.users -= 1
  if (one.users > 0) return
  shared.delete(host)
  await rpc.close()
}
