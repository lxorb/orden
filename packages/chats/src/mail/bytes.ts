/** Bytes and words for the mail protocols, which are ASCII lines around 8-bit bodies. */

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
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at] ?? 0
    const b = bytes[at + 1] ?? 0
    const c = bytes[at + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += at + 1 < bytes.length ? B64.charAt((n >> 6) & 63) : '='
    out += at + 2 < bytes.length ? B64.charAt(n & 63) : '='
  }
  return out
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let held = 0
  let at = 0
  for (const char of clean) {
    held = (held << 6) | B64.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[at++] = (held >> bits) & 0xff
    }
  }
  return out.subarray(0, at)
}

/** Lines out of a stream of chunks, CRLF or LF, and runs of raw bytes when asked. */
export class Reader {
  private held: Uint8Array = new Uint8Array(0)

  push(bytes: Uint8Array): void {
    this.held = this.held.length ? concat([this.held, bytes]) : bytes
  }

  /** A line without its ending, or null until one has arrived whole. */
  line(): string | null {
    const end = this.held.indexOf(10)
    if (end < 0) return null
    const cut = end > 0 && this.held[end - 1] === 13 ? end - 1 : end
    const line = latin(this.held.subarray(0, cut))
    this.held = this.held.subarray(end + 1)
    return line
  }

  take(count: number): Uint8Array | null {
    if (this.held.length < count) return null
    const out = this.held.slice(0, count)
    this.held = this.held.subarray(count)
    return out
  }
}
