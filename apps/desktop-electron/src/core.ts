import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Frames, framed, PROTOCOL, TO_CORE, TO_SHELL } from './wire'
import type { Frame, FromShell } from './wire'

const PATIENCE = 5000
export interface Hooks {
  identifier: string
  heard: (frame: Frame) => void
  silent: () => void
  left: (code: number) => void
}
export class Core {
  readonly #hooks: Hooks
  #to: Socket | null = null
  #silent = false
  readonly #sockets: Socket[] = []
  #child: ChildProcess | null = null
  #greeted = false
  #at: string | null = null
  constructor(hooks: Hooks) {
    this.#hooks = hooks
  }
  readonly send = (head: FromShell, body?: Uint8Array): void => {
    if (this.#to?.writable) this.#to.write(framed(head, body))
  }
  start(program: string, env: NodeJS.ProcessEnv): void {
    const twin = process.platform === 'win32'
    const at = twin
      ? `\\\\.\\pipe\\orden-electron-${process.pid}-${randomUUID()}`
      : join(mkdtempSync(join(tmpdir(), 'orden-electron-')), 'shell.sock')
    this.#at = at
    const served = twin
      ? [this.#serve(at + TO_CORE, true, false), this.#serve(at + TO_SHELL, false, true)]
      : [this.#serve(at, true, true)]
    Promise.all(served).then(
      () => {
        const child = spawn(program, [`--orden-electron-pipe=${at}`], {
          env,
          stdio: ['ignore', 'inherit', 'inherit'],
          windowsHide: true,
        })
        this.#child = child
        child.on('error', (error) => {
          console.error(`the core at ${program} could not be started`, error)
          this.#gone(1)
        })
        child.on('exit', (code) => {
          this.#gone(code ?? 1)
        })
      },
      (error: unknown) => {
        console.error('the pipe for the core could not be opened', error)
        this.#hooks.left(1)
      },
    )
  }
  end(): void {
    for (const socket of this.#sockets) socket.destroy()
    if (!this.#child) return
    const child = this.#child
    setTimeout(() => child.kill('SIGKILL'), PATIENCE)
  }
  kill(): void {
    this.#child?.kill('SIGKILL')
  }
  get running(): boolean {
    return this.#child !== null
  }
  #gone(code: number): void {
    if (!this.#child) return
    this.#child = null
    for (const socket of this.#sockets) socket.destroy()
    if (this.#at && process.platform !== 'win32') rmSync(dirname(this.#at), { recursive: true, force: true })
    this.#hooks.left(code)
  }
  #serve(at: string, speaks: boolean, hears: boolean): Promise<void> {
    return new Promise((ready, failed) => {
      const server = createServer((socket) => {
        server.close()
        this.#sockets.push(socket)
        if (speaks) this.#to = socket
        const frames = new Frames()
        socket.on('data', (chunk) => {
          if (!hears) return
          try {
            for (const frame of frames.take(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)) this.#take(frame)
          } catch (error) {
            console.error('the core said something that is no message', error)
            this.end()
          }
        })
        socket.on('error', () => {
          socket.destroy()
        })
        socket.on('close', () => {
          if (this.#silent) return
          this.#silent = true
          this.#to = null
          this.#hooks.silent()
          this.end()
        })
      })
      server.on('error', failed)
      server.listen(at, ready)
    })
  }
  #take(frame: Frame): void {
    if (process.env.ORDEN_ELECTRON_TRACE) console.error('the core says', frame.head.op, frame.body.length)
    if (this.#greeted) {
      this.#hooks.heard(frame)
      return
    }
    const hello = frame.head
    if (hello.op !== 'hello' || hello.identifier !== this.#hooks.identifier) {
      console.error(
        `this shell runs only a core built as ${this.#hooks.identifier}, and this one says`,
        hello.op === 'hello' ? hello.identifier : hello.op,
      )
      this.end()
      return
    }
    this.#greeted = true
    this.send({ op: 'welcome', protocol: PROTOCOL })
    if (hello.protocol !== PROTOCOL)
      console.error(`the core speaks protocol ${hello.protocol} and this shell speaks ${PROTOCOL}`)
  }
}
