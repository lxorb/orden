const encoder = new TextEncoder()

export function ascii(text: string): Uint8Array {
  return encoder.encode(text)
}

export function latin(bytes: Uint8Array): string {
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return text
}

export function fromLatin(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at) & 0xff
  return bytes
}

export function decode(bytes: Uint8Array, charset = 'utf-8'): string {
  const name = charset.trim().toLowerCase().replace(/^"|"$/g, '') || 'utf-8'
  try {
    return new TextDecoder(name === 'us-ascii' ? 'utf-8' : name).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0))
  let at = 0
  for (const one of parts) {
    out.set(one, at)
    at += one.length
  }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(bytes: Uint8Array): string {
  return latin(base64Lines(bytes))
}

export function base64Lines(bytes: Uint8Array, width = 0): Uint8Array {
  const chars = Math.ceil(bytes.length / 3) * 4
  const lines = width > 0 && chars > 0 ? Math.ceil(chars / width) : 1
  const out = new Uint8Array(chars + (lines - 1) * 2)
  let at = 0
  let inLine = 0
  const put = (code: number) => {
    if (width > 0 && inLine === width) {
      out[at++] = 13
      out[at++] = 10
      inLine = 0
    }
    out[at++] = code
    inLine++
  }
  for (let read = 0; read < bytes.length; read += 3) {
    const a = bytes[read] ?? 0
    const b = bytes[read + 1] ?? 0
    const c = bytes[read + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    put(B64.charCodeAt((n >> 18) & 63))
    put(B64.charCodeAt((n >> 12) & 63))
    put(read + 1 < bytes.length ? B64.charCodeAt((n >> 6) & 63) : 61)
    put(read + 2 < bytes.length ? B64.charCodeAt(n & 63) : 61)
  }
  return out
}

const SIXES = new Int8Array(256).fill(-1)
for (let at = 0; at < B64.length; at++) SIXES[B64.charCodeAt(at)] = at

export function fromBase64(text: string | Uint8Array): Uint8Array {
  const length = text.length
  const out = new Uint8Array(Math.floor((length * 3) / 4))
  let bits = 0
  let held = 0
  let at = 0
  for (let read = 0; read < length; read++) {
    const char = typeof text === 'string' ? text.charCodeAt(read) : (text[read] ?? 0)
    const six = char < 256 ? (SIXES[char] ?? -1) : -1
    if (six < 0) continue
    held = ((held << 6) | six) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at++] = (held >> bits) & 0xff
    }
  }
  return out.subarray(0, at)
}

export class Reader {
  private held = new Uint8Array(0)
  private start = 0
  private end = 0
  private looked = 0

  push(bytes: Uint8Array): void {
    if (this.end + bytes.length > this.held.length) {
      const kept = this.end - this.start
      const room =
        kept + bytes.length <= this.held.length / 2
          ? this.held
          : new Uint8Array(Math.max(1024, (kept + bytes.length) * 2))
      if (room === this.held) this.held.copyWithin(0, this.start, this.end)
      else room.set(this.held.subarray(this.start, this.end))
      this.held = room
      this.looked -= this.start
      this.start = 0
      this.end = kept
    }
    this.held.set(bytes, this.end)
    this.end += bytes.length
  }

  line(): string | null {
    const found = this.held.subarray(0, this.end).indexOf(10, Math.max(this.start, this.looked))
    if (found < 0) {
      this.looked = this.end
      return null
    }
    const cut = found > this.start && this.held[found - 1] === 13 ? found - 1 : found
    const line = latin(this.held.subarray(this.start, cut))
    this.start = found + 1
    this.looked = this.start
    this.settle()
    return line
  }

  take(count: number): Uint8Array | null {
    if (this.end - this.start < count) return null
    const out = this.held.slice(this.start, this.start + count)
    this.start += count
    this.looked = Math.max(this.looked, this.start)
    this.settle()
    return out
  }

  private settle(): void {
    if (this.start < this.end) return
    this.start = 0
    this.end = 0
    this.looked = 0
    if (this.held.length > 1 << 20) this.held = new Uint8Array(0)
  }
}
