import { Buffer } from 'buffer'
import EventEmitter from 'events'
import type { WireAsk, WireSocket } from '@orden/chats/provider'

type Dial = (ask: WireAsk) => Promise<WireSocket>

let dial: Dial | null = null

export function useWire(wire: Dial): void {
  dial = wire
}

interface Options {
  origin?: string
  headers?: Record<string, string>
}

export default class WebSocket extends EventEmitter {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = WebSocket.CONNECTING
  private socket: WireSocket | null = null
  private closed = false

  constructor(url: URL | string, options: Options = {}) {
    super()
    void this.open(String(url), options)
  }

  private async open(url: string, options: Options): Promise<void> {
    if (!dial) {
      this.fail(new Error('no connection to the outside here'))
      return
    }
    try {
      const headers: Record<string, string> = { ...options.headers }
      if (options.origin) headers.Origin = options.origin
      const socket = await dial({ url, headers })
      if (this.closed) {
        await socket.close()
        this.ended(1000, '')
        return
      }
      this.socket = socket
      this.readyState = WebSocket.OPEN
      socket.read(
        (data) =>
          this.emit(
            'message',
            typeof data === 'string'
              ? data
              : Buffer.from(data.buffer, data.byteOffset, data.byteLength),
          ),
        (reason) => this.ended(this.readyState === WebSocket.CLOSING ? 1000 : 1006, reason ?? ''),
      )
      this.emit('open')
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private fail(error: Error): void {
    this.emit('error', error)
    this.ended(1006, error.message)
  }

  private ended(code: number, reason: string): void {
    if (this.readyState === WebSocket.CLOSED) return
    this.closed = true
    this.readyState = WebSocket.CLOSED
    this.socket = null
    this.emit('close', code, Buffer.from(reason))
  }

  send(data: Uint8Array | string, done?: (error?: Error) => void): void {
    const socket = this.socket
    if (!socket) {
      done?.(new Error('the connection is not open'))
      return
    }
    socket.send(data).then(
      () => done?.(),
      (error: unknown) => done?.(error instanceof Error ? error : new Error(String(error))),
    )
  }

  close(): void {
    this.closed = true
    const socket = this.socket
    if (!socket) {
      if (this.readyState !== WebSocket.CONNECTING) this.ended(1000, '')
      return
    }
    this.readyState = WebSocket.CLOSING
    void socket.close().finally(() => this.ended(1000, ''))
  }
}
