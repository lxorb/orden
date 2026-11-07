import { type Api, isRecord, record, type Said, sleep, type Sleep, SlackError, text } from './api'

export interface Line {
  send(data: string): void
  close(): void
}

export interface LineEvents {
  message(data: string): void
  closed(): void
}

export type Dial = (url: string, events: LineEvents) => Line

export type SocketState = 'online' | 'connecting' | 'offline'

const MOST_WAIT = 60_000

export class SocketMode {
  private line: Line | null = null
  private stopped = false
  private failures = 0
  private running: Promise<void> | null = null

  constructor(
    private readonly api: Api,
    private readonly dial: Dial,
    private readonly heard: (event: Said) => void,
    private readonly state: (state: SocketState) => void,
    private readonly wait: Sleep = sleep,
  ) {}

  begin(): void {
    this.running ??= this.connect()
  }

  private async connect(): Promise<void> {
    while (!this.stopped) {
      this.state('connecting')
      let url = ''
      try {
        url = text((await this.api.call('apps.connections.open')).url)
      } catch (error) {
        if (error instanceof SlackError && error.signedOut) {
          this.stopped = true
          return
        }
      }
      if (this.halted()) return
      if (!url) {
        await this.backOff()
        continue
      }
      await new Promise<void>((done) => {
        let finished = false
        const end = () => {
          if (finished) return
          finished = true
          this.line = null
          done()
        }
        this.line = this.dial(url, {
          message: (data) => {
            if (this.hear(data)) {
              this.line?.close()
              end()
            }
          },
          closed: end,
        })
      })
      if (this.halted()) return
      this.state('offline')
      await this.backOff()
    }
  }

  private halted(): boolean {
    return this.stopped
  }

  private async backOff(): Promise<void> {
    this.failures += 1
    await this.wait(Math.min(MOST_WAIT, 1000 * 2 ** Math.min(this.failures, 6)))
  }

  private hear(data: string): boolean {
    let said: unknown
    try {
      said = JSON.parse(data)
    } catch {
      return false
    }
    if (!isRecord(said)) return false
    const envelope = text(said.envelope_id)
    if (envelope) this.line?.send(JSON.stringify({ envelope_id: envelope }))
    if (said.type === 'hello') {
      this.failures = 0
      this.state('online')
      return false
    }
    if (said.type === 'disconnect') return true
    if (said.type === 'events_api') {
      const event = record(record(said.payload).event)
      if (event.type) this.heard(event)
    }
    return false
  }

  stop(): void {
    this.stopped = true
    this.line?.close()
    this.line = null
  }
}
