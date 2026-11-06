const encoder = new TextEncoder()

export function now(): number {
  return Date.now()
}

export function newId(): string {
  return crypto.randomUUID()
}

export function byteLength(text: string): number {
  return encoder.encode(text).length
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function randomToken(): string {
  return [...randomBytes(32)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomCode(): string {
  const limit = 1_000_000
  const ceiling = Math.floor(0xffffffff / limit) * limit

  for (;;) {
    const view = new DataView(randomBytes(4).buffer)
    const value = view.getUint32(0)
    if (value < ceiling) return String(value % limit).padStart(6, '0')
  }
}

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

export const NAME_LIMIT = 60

export function cleanPersonName(given: string): string {
  return given
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim()
}
