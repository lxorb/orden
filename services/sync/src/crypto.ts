const encoder = new TextEncoder()

export function now(): number {
  return Date.now()
}

export function newId(): string {
  return crypto.randomUUID()
}

/** What a string costs to store, which is what the quota counts. Its length in
 *  characters is not that: one emoji is a single character and four bytes, and
 *  counting characters let an account keep several times what it was allowed. */
export function byteLength(text: string): number {
  return encoder.encode(text).length
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function randomToken(): string {
  return [...randomBytes(32)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Six digits, uniformly distributed - rejection sampling avoids modulo bias. */
export function randomCode(): string {
  const limit = 1_000_000
  const ceiling = Math.floor(0xffffffff / limit) * limit

  for (;;) {
    const view = new DataView(randomBytes(4).buffer)
    const value = view.getUint32(0)
    if (value < ceiling) return String(value % limit).padStart(6, '0')
  }
}

/** Constant-time compare, so a wrong code leaks nothing through timing. */
export function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isEmail(email: string): boolean {
  return EMAIL.test(email) && email.length <= 254
}
