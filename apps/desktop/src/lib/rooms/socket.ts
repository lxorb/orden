import { subprotocol } from '@orden/rooms'
import { roomDelay } from '../backoff'
import { BASE } from '../api'

export interface Wire {
  opened: () => void
  heard: (message: Uint8Array) => void
  closed: (code: number, said: string) => void
}

function roomUrl(noteId: string): string {
  return `${BASE.replace(/^http/, 'ws')}/rooms/${encodeURIComponent(noteId)}`
}

export class RoomSocket {
  private socket: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private tries = 0
  private stopped = false

  constructor(
    private readonly noteId: string,
    private readonly token: string,
    private readonly wire: Wire,
    private readonly offers: readonly string[] = [],
  ) {}

  get open(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  start() {
    this.stopped = false
    this.connect()
  }

  send(message: Uint8Array): boolean {
    if (!this.open) return false

    this.socket?.send(message.slice())
    return true
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      socket.close()
    }
  }

  private connect() {
    if (this.stopped) return

    let socket: WebSocket
    try {
      socket = new WebSocket(roomUrl(this.noteId), [subprotocol(this.token), ...this.offers])
    } catch {
      this.again()
      return
    }

    this.socket = socket
    socket.binaryType = 'arraybuffer'

    socket.onopen = () => {
      this.tries = 0
      this.wire.opened()
    }

    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) this.wire.heard(new Uint8Array(event.data))
    }

    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return

      this.socket = null
      this.wire.closed(event.code, event.reason)
      this.again()
    }

    socket.onerror = () => undefined
  }

  private again() {
    if (this.stopped || this.timer) return

    this.tries++
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, roomDelay(this.tries))
  }
}
