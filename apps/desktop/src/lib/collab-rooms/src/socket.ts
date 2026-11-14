import { subprotocol } from '@orden/rooms'
import { BEAT, BEAT_ANSWER } from '@orden/sync-core'
import { BEAT_EVERY, roomDelay } from '../../backoff'
import { BASE } from '../../accounts/src/api'

const SILENT_BEATS = 3

const OPEN_WITHIN = 10_000

const SILENT = 4000

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
  private beat: ReturnType<typeof setInterval> | null = null
  private opening: ReturnType<typeof setTimeout> | null = null
  private quiet = 0
  private answers = false

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
    if (typeof window !== 'undefined') window.addEventListener('online', this.back)
    this.connect()
  }

  send(message: Uint8Array): boolean {
    if (!this.open) return false

    this.socket?.send(message.slice())
    return true
  }

  stop() {
    this.stopped = true
    if (typeof window !== 'undefined') window.removeEventListener('online', this.back)
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.drop()
  }

  private readonly back = () => {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
    this.tries = 0
    this.connect()
  }

  private drop() {
    if (this.beat) clearInterval(this.beat)
    this.beat = null
    if (this.opening) clearTimeout(this.opening)
    this.opening = null

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

  private lost(socket: WebSocket) {
    if (this.socket !== socket) return
    this.drop()
    this.wire.closed(SILENT, 'heard nothing')
    this.again()
  }

  private beating(socket: WebSocket) {
    this.quiet = 0
    this.answers = false
    if (this.beat) clearInterval(this.beat)
    this.beat = setInterval(() => {
      if (this.socket !== socket) return
      this.quiet += 1
      if (this.answers && this.quiet >= SILENT_BEATS) {
        this.lost(socket)
        return
      }
      try {
        socket.send(BEAT)
      } catch {
        // Closing; its close brings the next try.
      }
    }, BEAT_EVERY)
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

    this.opening = setTimeout(() => {
      this.opening = null
      if (socket.readyState !== WebSocket.OPEN) this.lost(socket)
    }, OPEN_WITHIN)

    socket.onopen = () => {
      if (this.opening) clearTimeout(this.opening)
      this.opening = null
      this.tries = 0
      this.beating(socket)
      this.wire.opened()
    }

    socket.onmessage = (event: MessageEvent<unknown>) => {
      this.quiet = 0
      if (event.data === BEAT_ANSWER) this.answers = true
      if (event.data instanceof ArrayBuffer) this.wire.heard(new Uint8Array(event.data))
    }

    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return

      this.drop()
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
