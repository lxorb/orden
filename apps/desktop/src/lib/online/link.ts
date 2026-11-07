import {
  type ClientFrame,
  outOf,
  type Refusal,
  type ServerFrame,
  serverFrameOf,
  socketPath,
} from '@orden/online/wire'
import { BEAT, DEVICE_PROTOCOL, TOKEN_PROTOCOL } from '@orden/sync-core/wire'
import { BEAT_EVERY, linkDelay } from '../backoff'

export interface LinkSocket {
  readonly open: boolean
  readonly buffered: number
  send(data: string | Uint8Array): void
  close(): void
}

export interface LinkWorld {
  base: string
  token(): string | null
  device(): Promise<string>
  socket(
    url: string,
    protocols: string[],
    events: {
      opened(): void
      heard(data: string | ArrayBuffer): void
      closed(code: number): void
    },
  ): LinkSocket
  after(ms: number, run: () => void): () => void
  now(): number
  hidden(): boolean
  watch(back: () => void): () => void
}

export type Opened = { t: 'open' } | { t: 'dropped' }

export type Heard = { t: 'out'; data: Uint8Array } | ServerFrame | Opened

const SILENT_BEATS = 3

export const PROBE_WITHIN = 3_000

export const OPEN_WITHIN = 10_000

const SLEPT = BEAT_EVERY

const FINAL: readonly Refusal[] = ['gone', 'list', 'allowance', 'budget', 'off', 'flag']

export abstract class Channel<In extends { t: string }, Out extends { t: string }> {
  private socket: LinkSocket | null = null
  private retry: (() => void) | null = null
  private tries = 0
  private closed = false
  private stopped = false
  private quiet = 0
  private stopBeat: (() => void) | null = null
  private probing: (() => void) | null = null
  private opening: (() => void) | null = null
  private madeAt = 0
  private unwatch: (() => void) | null = null

  constructor(
    private readonly name: string,
    private readonly world: LinkWorld,
    protected readonly heard: (what: In | Opened) => void,
  ) {}

  protected abstract path(name: string): string
  protected abstract helloFrame(): Out
  protected abstract read(data: string | ArrayBuffer): In | null
  protected abstract final(frame: In): boolean
  protected typing(_frame: Out): boolean {
    return false
  }

  protected role(): string[] {
    return []
  }

  open(): void {
    this.closed = false
    this.stopped = false
    this.retry?.()
    this.retry = null
    this.unwatch ??= this.world.watch(() => {
      this.back()
    })
    this.connect()
  }

  private back(): void {
    if (this.closed || this.stopped) return
    const socket = this.socket
    if (socket?.open) {
      this.probe()
      return
    }
    if (socket) {
      if (this.world.now() - this.madeAt < PROBE_WITHIN) return
      this.tries = 0
      this.drop(socket, true)
      return
    }
    if (!this.retry) return
    this.tries = 0
    this.retry()
    this.retry = null
    this.connect()
  }

  private connect(): void {
    const token = this.world.token()
    if (this.closed || this.socket || !token) return

    void this.world.device().then(
      (device) => {
        if (this.closed || this.socket) return
        const url = `${this.world.base.replace(/^http/, 'ws')}${this.path(this.name)}`
        let socket: LinkSocket | null = null
        try {
          const protocols = [
            `${TOKEN_PROTOCOL}${token}`,
            `${DEVICE_PROTOCOL}${device}`,
            ...this.role(),
          ]
          socket = this.world.socket(url, protocols, {
            opened: () => {
              if (this.socket !== socket || !socket) return
              this.opening?.()
              this.opening = null
              this.tries = 0
              this.quiet = 0
              this.beat(socket)
              this.hello()
              this.heard({ t: 'open' })
            },
            heard: (data) => {
              if (this.socket !== socket) return
              this.quiet = 0
              this.probing?.()
              this.probing = null
              this.hear(data)
            },
            closed: () => {
              if (this.socket !== socket) return
              this.socket = null
              this.again()
            },
          })
        } catch {
          this.again()
          return
        }
        this.socket = socket
        const made = socket
        this.madeAt = this.world.now()
        this.opening = this.world.after(OPEN_WITHIN, () => {
          this.opening = null
          if (this.socket === made && !made.open) this.drop(made)
        })
      },
      () => {
        this.again()
      },
    )
  }

  private beat(socket: LinkSocket): void {
    this.stopBeat?.()
    const set = this.world.now()
    this.stopBeat = this.world.after(BEAT_EVERY, () => {
      this.stopBeat = null
      if (this.socket !== socket) return
      this.beat(socket)
      if (this.world.now() - set > BEAT_EVERY + SLEPT) {
        this.probe()
        return
      }
      this.quiet += 1
      if (this.quiet >= SILENT_BEATS) {
        this.drop(socket)
        return
      }
      this.send(socket, BEAT)
    })
  }

  private probe(): void {
    const socket = this.socket
    if (!socket?.open || this.probing) return
    this.send(socket, BEAT)
    this.answer(socket)
  }

  private answer(socket: LinkSocket): void {
    this.probing = this.world.after(PROBE_WITHIN, () => {
      this.probing = null
      if (this.socket !== socket) return
      if (socket.buffered > 0) this.answer(socket)
      else this.drop(socket)
    })
  }

  private drop(socket: LinkSocket, now = false): void {
    this.socket = null
    socket.close()
    this.again(now)
  }

  private again(now = false): void {
    this.stopBeat?.()
    this.stopBeat = null
    this.probing?.()
    this.probing = null
    this.opening?.()
    this.opening = null
    if (this.closed || this.stopped || this.retry) return
    this.heard({ t: 'dropped' })
    if (now) {
      this.connect()
      return
    }
    this.tries += 1
    this.retry = this.world.after(linkDelay(this.tries, this.world.hidden()), () => {
      this.retry = null
      this.connect()
    })
  }

  private send(socket: LinkSocket, data: string | Uint8Array): void {
    try {
      socket.send(data)
    } catch {
      // Closing under us: its close brings the next one.
    }
  }

  private hear(data: string | ArrayBuffer): void {
    const frame = this.read(data)
    if (!frame) return
    if (frame.t === 'hold') this.hello()
    if (this.final(frame)) this.stopped = true
    this.heard(frame)
  }

  say(frame: Out): boolean {
    if (!this.socket?.open) return false
    this.send(this.socket, JSON.stringify(frame))
    if (this.typing(frame)) this.probe()
    return true
  }

  protected sayRaw(bytes: Uint8Array): boolean {
    if (!this.socket?.open) return false
    this.send(this.socket, bytes)
    this.probe()
    return true
  }

  private hello(): void {
    if (!this.socket?.open) return
    this.send(this.socket, JSON.stringify(this.helloFrame()))
  }

  take(): boolean {
    if (!this.socket?.open) return false
    this.send(this.socket, JSON.stringify({ t: 'take' }))
    return true
  }

  get live(): boolean {
    return this.socket?.open === true
  }

  close(): void {
    this.closed = true
    this.stopBeat?.()
    this.stopBeat = null
    this.probing?.()
    this.probing = null
    this.opening?.()
    this.opening = null
    this.retry?.()
    this.retry = null
    this.unwatch?.()
    this.unwatch = null
    const socket = this.socket
    this.socket = null
    if (socket?.open) this.send(socket, JSON.stringify({ t: 'leave' }))
    socket?.close()
  }
}

export class Link extends Channel<Exclude<Heard, Opened>, ClientFrame> {
  private since: number | null = null
  private size: { cols: number; rows: number }

  constructor(
    term: string,
    world: LinkWorld,
    heard: (what: Heard) => void,
    cols: number,
    rows: number,
  ) {
    super(term, world, heard)
    this.size = { cols, rows }
  }

  protected path(term: string): string {
    return socketPath(term)
  }

  protected helloFrame(): ClientFrame {
    return {
      t: 'hello',
      ...this.size,
      ...(this.since === null ? {} : { since: this.since }),
      hold: true,
    }
  }

  protected read(data: string | ArrayBuffer): Exclude<Heard, Opened> | null {
    if (typeof data !== 'string') {
      const out = outOf(new Uint8Array(data))
      if (!out) return null
      const end = out.seq + out.data.length
      if (this.since !== null && end <= this.since) return null
      const skip = this.since === null ? 0 : Math.max(0, this.since - out.seq)
      this.since = end
      return { t: 'out', data: out.data.subarray(skip) }
    }
    const frame = serverFrameOf(data)
    if (frame?.t === 'screen') this.since = frame.seq
    return frame
  }

  protected final(frame: Exclude<Heard, Opened>): boolean {
    return frame.t === 'refused' && FINAL.includes(frame.error)
  }

  protected override typing(frame: ClientFrame): boolean {
    return frame.t === 'in'
  }

  sayBytes(bytes: Uint8Array): boolean {
    return this.sayRaw(bytes)
  }

  resize(cols: number, rows: number): void {
    if (cols === this.size.cols && rows === this.size.rows) return
    this.size = { cols, rows }
    this.say({ t: 'size', cols, rows })
  }
}

export function pageWorld(
  base: string,
  token: () => string | null,
  device: () => Promise<string>,
): LinkWorld {
  return {
    base,
    token,
    device,
    socket: (url, protocols, events) => {
      const socket = new WebSocket(url, protocols)
      socket.binaryType = 'arraybuffer'
      socket.onopen = () => {
        events.opened()
      }
      socket.onmessage = (event: MessageEvent<unknown>) => {
        const { data } = event
        if (typeof data === 'string' || data instanceof ArrayBuffer) events.heard(data)
      }
      socket.onclose = (event) => {
        events.closed(event.code)
      }
      socket.onerror = () => undefined
      return {
        get open() {
          return socket.readyState === WebSocket.OPEN
        },
        get buffered() {
          return socket.bufferedAmount
        },
        send: (data) => {
          socket.send(data)
        },
        close: () => {
          socket.onopen = null
          socket.onmessage = null
          socket.onclose = null
          socket.close()
        },
      }
    },
    after: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    now: () => Date.now(),
    hidden: () => document.visibilityState === 'hidden',
    watch: (back) => {
      const looked = () => {
        if (document.visibilityState !== 'hidden') back()
      }
      addEventListener('online', back)
      addEventListener('focus', looked)
      document.addEventListener('visibilitychange', looked)
      return () => {
        removeEventListener('online', back)
        removeEventListener('focus', looked)
        document.removeEventListener('visibilitychange', looked)
      }
    },
  }
}
