import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import {
  frameOf,
  Frames,
  type FromHolder,
  fromHolderOf,
  type Hello,
  HOLD_SPEC,
  type Spec,
  type ToHolder,
} from './hold-wire'
import { killSession } from './limits'

const ANSWER_WITHIN = 30_000
const START_WITHIN = 15_000
const LOOK_EVERY = 25

export interface Events {
  out(seq: number, data: Uint8Array): void
  exit(code: number | null): void
}

const waited = (ms: number) => new Promise((settle) => setTimeout(settle, ms))

export function socketOf(holds: string, session: string): string {
  return join(holds, `${session}.sock`)
}

export class Held {
  private socket: Socket | null = null
  private readonly waiting: ToHolder[] = []
  private attached = false
  private letGo = false
  private killing = false
  private ended = false
  hello: Hello | null = null

  constructor(
    readonly path: string,
    private readonly events: Events,
  ) {}

  async find(): Promise<Hello | null> {
    const socket = connect(this.path)
    const frames = new Frames()
    const hello = await new Promise<Hello | null>((settle) => {
      const timer = setTimeout(() => {
        settle(null)
      }, ANSWER_WITHIN)
      const done = (value: Hello | null) => {
        clearTimeout(timer)
        settle(value)
      }
      socket.once('error', () => {
        done(null)
      })
      socket.once('close', () => {
        done(null)
      })
      socket.on('data', (chunk: Buffer) => {
        for (const raw of frames.push(chunk)) {
          const frame = fromHolderOf(raw)
          if (frame?.t === 'hello' && !this.hello) {
            this.hello = frame
            done(frame)
          } else if (frame) this.heard(frame)
        }
        if (frames.broken) socket.destroy()
      })
    })
    if (!hello || this.letGo) {
      socket.destroy()
      if (hello && this.killing) this.kill()
      return null
    }
    this.socket = socket
    socket.removeAllListeners('close')
    socket.on('error', () => undefined)
    socket.on('close', () => {
      this.gone()
    })
    if (this.killing) this.kill()
    return hello
  }

  async start(holder: string, spec: Spec, env: Record<string, string>): Promise<Hello> {
    const child = spawn(process.execPath, [holder], {
      detached: true,
      stdio: 'ignore',
      env: { ...env, [HOLD_SPEC]: JSON.stringify(spec) },
    })
    const started = { gone: false }
    child.once('exit', () => {
      started.gone = true
    })
    child.once('error', () => {
      started.gone = true
    })
    child.unref()
    const until = Date.now() + START_WITHIN
    while (!started.gone && !this.letGo && Date.now() < until) {
      const hello = await this.find()
      if (hello) return hello
      await waited(LOOK_EVERY)
    }
    if (!started.gone && (this.killing || !this.letGo)) child.kill('SIGKILL')
    throw new Error('the holder did not start')
  }

  attach(since: number): void {
    this.attached = true
    this.say({ t: 'attach', since })
    for (const frame of this.waiting.splice(0)) this.say(frame)
  }

  write(data: Uint8Array): void {
    this.tell({ t: 'in', data })
  }

  resize(cols: number, rows: number): void {
    this.tell({ t: 'size', cols, rows })
  }

  pause(paused: boolean): void {
    if (paused) this.socket?.pause()
    else this.socket?.resume()
  }

  detach(): void {
    this.letGo = true
    this.socket?.destroy()
    this.socket = null
  }

  kill(): void {
    this.killing = true
    this.detach()
    const hello = this.hello
    if (!hello) return
    killSession(hello.shell)
    try {
      process.kill(hello.holder, 'SIGKILL')
    } catch {
      // Gone already.
    }
    rmSync(this.path, { force: true })
  }

  private tell(frame: ToHolder): void {
    if (this.attached) this.say(frame)
    else this.waiting.push(frame)
  }

  private say(frame: ToHolder): void {
    if (this.socket?.writable) this.socket.write(frameOf(frame))
  }

  private heard(frame: FromHolder): void {
    if (frame.t === 'out') this.events.out(frame.seq, frame.data)
    else if (frame.t === 'exit') this.end(frame.code)
  }

  private gone(): void {
    if (!this.letGo) this.end(null)
  }

  private end(code: number | null): void {
    if (this.ended) return
    this.ended = true
    this.letGo = true
    this.socket = null
    this.events.exit(code)
  }
}
