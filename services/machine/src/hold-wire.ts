export const HOLD_VERSION = 1

export const HOLD_SPEC = 'NIBD_HOLD'

export interface Spec {
  socket: string
  cgroup: string | null
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  base: number
}

export function specOf(raw: string | undefined): Spec | null {
  let spec: Partial<Spec>
  try {
    spec = JSON.parse(raw ?? '') as Partial<Spec>
  } catch {
    return null
  }
  const { socket, cgroup, file, args, cwd, cols, rows, base } = spec
  if (typeof socket !== 'string' || typeof file !== 'string' || typeof cwd !== 'string') return null
  if (!Array.isArray(args) || !args.every((one) => typeof one === 'string')) return null
  if (cgroup !== null && typeof cgroup !== 'string') return null
  if (!isSize(cols) || !isSize(rows) || !isCount(base)) return null
  return { socket, cgroup, file, args, cwd, cols, rows, base }
}

export interface Exit {
  code: number | null
}

export interface Hello {
  t: 'hello'
  v: number
  holder: number
  shell: number
  base: number
  from: number
  end: number
  cols: number
  rows: number
  exited: Exit | null
}

export type FromHolder =
  Hello | { t: 'out'; seq: number; data: Uint8Array } | ({ t: 'exit' } & Exit)

export type ToHolder =
  | { t: 'attach'; since: number }
  | { t: 'in'; data: Uint8Array }
  | { t: 'size'; cols: number; rows: number }

const HELLO = 1
const OUT = 2
const EXIT = 3
const ATTACH = 10
const IN = 11
const SIZE = 12

const MOST_FRAME = 16 * 1024 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function framed(kind: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length + 1)
  view.setUint8(4, kind)
  out.set(body, 5)
  return out
}

function json(kind: number, value: unknown): Uint8Array {
  return framed(kind, encoder.encode(JSON.stringify(value)))
}

function offsetThen(seq: number, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(8 + data.length)
  new DataView(body.buffer).setFloat64(0, seq)
  body.set(data, 8)
  return body
}

export function frameOf(frame: FromHolder | ToHolder): Uint8Array {
  switch (frame.t) {
    case 'hello':
      return json(HELLO, frame)
    case 'out':
      return framed(OUT, offsetThen(frame.seq, frame.data))
    case 'exit':
      return json(EXIT, { code: frame.code })
    case 'attach':
      return json(ATTACH, { since: frame.since })
    case 'in':
      return framed(IN, frame.data)
    case 'size':
      return json(SIZE, { cols: frame.cols, rows: frame.rows })
  }
}

export interface Raw {
  kind: number
  body: Uint8Array
}

export class Frames {
  private held = new Uint8Array(0)
  broken = false

  push(chunk: Uint8Array): Raw[] {
    const all = new Uint8Array(this.held.length + chunk.length)
    all.set(this.held)
    all.set(chunk, this.held.length)
    const out: Raw[] = []
    let at = 0
    while (all.length - at >= 5) {
      const view = new DataView(all.buffer, all.byteOffset + at)
      const length = view.getUint32(0)
      if (length < 1 || length > MOST_FRAME) {
        this.broken = true
        this.held = new Uint8Array(0)
        return out
      }
      if (all.length - at - 4 < length) break
      out.push({ kind: view.getUint8(4), body: all.slice(at + 5, at + 4 + length) })
      at += 4 + length
    }
    this.held = all.slice(at)
    return out
  }
}

function parsed(body: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(decoder.decode(body))
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isSize = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1000

function exitOf(value: unknown): Exit | null {
  if (typeof value !== 'object' || value === null) return null
  const code = (value as { code?: unknown }).code
  return code === null || (typeof code === 'number' && Number.isInteger(code)) ? { code } : null
}

export function fromHolderOf(raw: Raw): FromHolder | null {
  if (raw.kind === OUT) {
    if (raw.body.length < 8) return null
    const seq = new DataView(raw.body.buffer, raw.body.byteOffset).getFloat64(0)
    return isCount(seq) ? { t: 'out', seq, data: raw.body.subarray(8) } : null
  }
  const value = parsed(raw.body)
  if (!value) return null
  if (raw.kind === EXIT) {
    const exit = exitOf(value)
    return exit && { t: 'exit', ...exit }
  }
  if (raw.kind !== HELLO) return null
  const { v, holder, shell, base, from, end, cols, rows } = value
  if (typeof v !== 'number' || v < 1) return null
  if (!isCount(holder) || !isCount(shell) || !isCount(base) || !isCount(from) || !isCount(end))
    return null
  if (!isSize(cols) || !isSize(rows) || from < base || end < from) return null
  const exited = value.exited === null ? null : exitOf(value.exited)
  if (exited === null && value.exited !== null) return null
  return { t: 'hello', v, holder, shell, base, from, end, cols, rows, exited }
}

export function toHolderOf(raw: Raw): ToHolder | null {
  if (raw.kind === IN) return { t: 'in', data: raw.body }
  const value = parsed(raw.body)
  if (!value) return null
  if (raw.kind === ATTACH) return isCount(value.since) ? { t: 'attach', since: value.since } : null
  if (raw.kind === SIZE) {
    const { cols, rows } = value
    return isSize(cols) && isSize(rows) ? { t: 'size', cols, rows } : null
  }
  return null
}
