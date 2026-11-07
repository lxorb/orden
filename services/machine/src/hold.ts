import { rmSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { spawn } from 'node-pty'
import {
  type Exit,
  frameOf,
  Frames,
  type FromHolder,
  HOLD_SPEC,
  HOLD_VERSION,
  type Raw,
  type Spec,
  specOf,
  toHolderOf,
} from './hold-wire'
import { enterCgroup } from './limits'
import { Ring } from './ring'

export const HELD = 4 * 1024 * 1024

const PART = 64 * 1024

const BEHIND = 1024 * 1024

function hold(spec: Spec, env: Record<string, string>): void {
  const ring = new Ring(spec.base, HELD)
  let size = { cols: spec.cols, rows: spec.rows }
  let client: Socket | null = null
  let attached = false
  let exited: Exit | null = null

  const pty = spawn(spec.file, spec.args, {
    name: 'xterm-256color',
    cols: spec.cols,
    rows: spec.rows,
    cwd: spec.cwd,
    env,
    encoding: null,
  })

  const say = (socket: Socket, frame: FromHolder): void => {
    socket.write(frameOf(frame))
  }
  const behind = (): void => {
    if (client && client.writableLength > BEHIND) pty.pause()
  }
  const quit = (): void => {
    server.close()
    rmSync(spec.socket, { force: true })
    process.exit(0)
  }
  const finish = (socket: Socket): void => {
    say(socket, { t: 'exit', ...(exited ?? { code: null }) })
    socket.end(quit)
  }

  pty.onData((data: string | Buffer) => {
    const bytes = typeof data === 'string' ? Buffer.from(data) : data
    const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const seq = ring.append(view)
    if (client && attached) {
      say(client, { t: 'out', seq, data: view })
      behind()
    }
  })
  pty.onExit(({ exitCode, signal }) => {
    exited = { code: signal ? null : exitCode }
    if (client && attached) finish(client)
  })

  const heard = (socket: Socket, raw: Raw): void => {
    const frame = toHolderOf(raw)
    if (!frame || socket !== client) return
    switch (frame.t) {
      case 'attach': {
        const from = Math.min(Math.max(frame.since, ring.start), ring.end)
        const kept = ring.since(from) ?? new Uint8Array(0)
        for (let at = 0; at < kept.length; at += PART) {
          say(socket, { t: 'out', seq: from + at, data: kept.subarray(at, at + PART) })
        }
        attached = true
        behind()
        if (exited) finish(socket)
        return
      }
      case 'in':
        if (!exited) pty.write(Buffer.from(frame.data))
        return
      case 'size':
        size = { cols: frame.cols, rows: frame.rows }
        if (!exited) pty.resize(frame.cols, frame.rows)
        return
    }
  }

  const server = createServer((socket) => {
    client?.destroy()
    client = socket
    attached = false
    pty.resume()
    say(socket, {
      t: 'hello',
      v: HOLD_VERSION,
      holder: process.pid,
      shell: pty.pid,
      base: spec.base,
      from: ring.start,
      end: ring.end,
      ...size,
      exited,
    })
    const frames = new Frames()
    socket.on('data', (chunk: Buffer) => {
      for (const raw of frames.push(chunk)) heard(socket, raw)
      if (frames.broken) socket.destroy()
    })
    socket.on('drain', () => {
      if (client === socket) pty.resume()
    })
    socket.on('error', () => {
      // A `ordend` that went away mid-write; its close below lets the pty go on.
    })
    socket.on('close', () => {
      if (client !== socket) return
      client = null
      attached = false
      pty.resume()
    })
  })
  rmSync(spec.socket, { force: true })
  const umask = process.umask(0o077)
  server.listen(spec.socket)
  process.umask(umask)
}

function main(): void {
  const spec = specOf(process.env[HOLD_SPEC])
  Reflect.deleteProperty(process.env, HOLD_SPEC)
  if (!spec) process.exit(2)
  process.on('uncaughtException', () => undefined)
  if (spec.cgroup) enterCgroup(spec.cgroup, process.pid)
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  hold(spec, env)
}

main()
