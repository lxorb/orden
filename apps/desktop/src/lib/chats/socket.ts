import type { Logged, Who } from '@orden/chats'
import { serverFrameOf, socketPath, text, type ClientFrame } from '@orden/chats/wire'
import { subprotocol } from '@orden/rooms'
import { BEAT, DEVICE_PROTOCOL } from '@orden/sync-core/wire'
import { BASE } from '../api'
import { BEAT_EVERY, roomDelay } from '../backoff'

const ENDED = 1008

export interface Heard {
  events(events: Logged[]): void
  behind(seq: number): void
  typing(who: Who, parent: string | undefined): void
  read(who: Who, seq: number): void
  here(who: Who[]): void
  profile(who: Who): void
  state(open: boolean): void
  ended(): void
}

export interface Wire {
  send(text: string): void
  close(): void
}

export type Dial = (
  url: string,
  protocols: string[],
  on: { opened(): void; heard(text: string): void; closed(code: number): void },
) => Wire

const dialWebSocket: Dial = (url, protocols, on) => {
  const socket = new WebSocket(url, protocols)
  socket.onopen = () => on.opened()
  socket.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data === 'string') on.heard(event.data)
  }
  socket.onclose = (event) => on.closed(event.code)
  socket.onerror = () => undefined
  return {
    send: (said) => socket.send(said),
    close: () => {
      socket.onclose = null
      socket.onmessage = null
      socket.close()
    },
  }
}

export class ChatSocket {
  private wire: Wire | null = null
  private greeted = false
  private stopped = false
  private tries = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private beat: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly chat: string,
    private readonly token: string,
    private readonly device: string | null,
    private readonly since: () => number,
    private readonly heard: Heard,
    private readonly dial: Dial = dialWebSocket,
  ) {
    this.connect()
  }

  get open(): boolean {
    return this.greeted
  }

  typing(parent?: string): boolean {
    return this.say(parent ? { t: 'typing', parent } : { t: 'typing' })
  }

  read(seq: number): boolean {
    return this.say({ t: 'read', seq })
  }

  close(): void {
    this.stopped = true
    clearTimeout(this.retry)
    this.drop()
  }

  private say(frame: ClientFrame): boolean {
    if (!this.greeted || !this.wire) return false
    try {
      this.wire.send(text(frame))
      return true
    } catch {
      return false
    }
  }

  private connect(): void {
    if (this.stopped) return
    const url = `${BASE.replace(/^http/, 'ws')}${socketPath(this.chat)}`
    const protocols = [
      subprotocol(this.token),
      ...(this.device ? [`${DEVICE_PROTOCOL}${this.device}`] : []),
    ]
    let wire: Wire | null = null
    try {
      wire = this.dial(url, protocols, {
        opened: () => {
          if (this.wire !== wire || !wire) return
          this.tries = 0
          wire.send(text({ t: 'hello', since: this.since() }))
          this.greeted = true
          this.heard.state(true)
          clearInterval(this.beat)
          this.beat = setInterval(() => {
            try {
              wire?.send(BEAT)
            } catch {
              // Closing; its close brings the next.
            }
          }, BEAT_EVERY)
        },
        heard: (said) => {
          if (this.wire === wire) this.hear(said)
        },
        closed: (code) => {
          if (this.wire !== wire) return
          this.drop()
          if (code === ENDED) {
            this.stopped = true
            this.heard.ended()
            return
          }
          this.again()
        },
      })
    } catch {
      this.again()
      return
    }
    this.wire = wire
  }

  private hear(said: string): void {
    const frame = serverFrameOf(said)
    if (!frame) return
    switch (frame.t) {
      case 'events':
        this.heard.events(frame.events)
        break
      case 'behind':
        this.heard.behind(frame.seq)
        break
      case 'typing':
        this.heard.typing(frame.who, frame.parent)
        break
      case 'read':
        this.heard.read(frame.who, frame.seq)
        break
      case 'here':
        this.heard.here(frame.who)
        break
      case 'profile':
        this.heard.profile(frame.who)
        break
      case 'placed':
      case 'refused':
        break
    }
  }

  private drop(): void {
    clearInterval(this.beat)
    this.beat = undefined
    const wire = this.wire
    this.wire = null
    if (this.greeted) {
      this.greeted = false
      this.heard.state(false)
    }
    wire?.close()
  }

  private again(): void {
    if (this.stopped || this.retry) return
    this.tries += 1
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.connect()
    }, roomDelay(this.tries))
  }
}
