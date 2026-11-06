export const FRAME_MS = 16

export const ECHO_MS = 50
export const ECHO_SENDS = 2

export class Coalescer {
  private pending: Uint8Array[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private last = -Infinity
  private echoUntil = -Infinity
  private echoes = 0
  private readonly send: (bytes: Uint8Array) => void
  private readonly now: () => number

  constructor(send: (bytes: Uint8Array) => void, now: () => number = () => performance.now()) {
    this.send = send
    this.now = now
  }

  typed(): void {
    this.echoUntil = this.now() + ECHO_MS
    this.echoes = ECHO_SENDS
  }

  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return
    this.pending.push(bytes)
    if (this.echoes > 0 && this.now() <= this.echoUntil) {
      this.echoes -= 1
      this.flush()
      return
    }
    if (this.timer) return
    const wait = this.last + FRAME_MS - this.now()
    if (wait <= 0) this.flush()
    else this.timer = setTimeout(() => this.flush(), wait)
  }

  flush(count = Infinity): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.pending.length === 0) return
    const all = joined(this.pending)
    const bytes = count < all.length ? all.subarray(0, count) : all
    this.pending = bytes === all ? [] : [all.subarray(bytes.length)]
    if (this.pending.length > 0) this.timer = setTimeout(() => this.flush(), FRAME_MS)
    if (bytes.length === 0) return
    this.last = this.now()
    this.send(bytes)
  }
}

function joined(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0]) return parts[0]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
