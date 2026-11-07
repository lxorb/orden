export const TOTP_ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'] as const

export type TotpAlgorithm = (typeof TOTP_ALGORITHMS)[number]

export interface Totp {
  secret: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  issuer: string
  label: string
}

export interface TotpCode {
  code: string
  remaining: number
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const BARE_LEAST = 16
const HASHES: Record<TotpAlgorithm, string> = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA512: 'SHA-512',
}

function secretIn(text: string, least: number): string | null {
  const secret = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
  if (secret.length < least || !/^[A-Z2-7]+$/.test(secret)) return null
  return [1, 3, 6].includes(secret.length % 8) ? null : secret
}

function unbase32(secret: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(Math.floor((secret.length * 5) / 8))
  let bits = 0
  let held = 0
  let at = 0
  for (const letter of secret) {
    held = ((held << 5) | BASE32.indexOf(letter)) & 0xffff
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes[at++] = (held >> bits) & 255
    }
  }
  return bytes
}

function whole(text: string | null, fallback: number, low: number, high: number): number | null {
  if (text === null) return fallback
  if (!/^[0-9]+$/.test(text)) return null
  const value = Number(text)
  return value >= low && value <= high ? value : null
}

function algorithmIn(text: string | null): TotpAlgorithm | null {
  const name = (text ?? 'SHA1').toUpperCase().replace('-', '')
  return TOTP_ALGORITHMS.find((one) => one === name) ?? null
}

function decoded(text: string): string | null {
  try {
    return decodeURIComponent(text)
  } catch {
    return null
  }
}

function uriIn(text: string): Totp | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol.toLowerCase() !== 'otpauth:' || url.hostname.toLowerCase() !== 'totp')
    return null
  const path = decoded(url.pathname.replace(/^\/+/, ''))
  const secret = secretIn(url.searchParams.get('secret') ?? '', 1)
  const algorithm = algorithmIn(url.searchParams.get('algorithm'))
  const digits = whole(url.searchParams.get('digits'), 6, 6, 8)
  const period = whole(url.searchParams.get('period'), 30, 1, 300)
  if (path === null || secret === null || algorithm === null || digits === null || period === null)
    return null
  const given = url.searchParams.get('issuer')
  const colon = given !== null && path.startsWith(`${given}:`) ? given.length : path.indexOf(':')
  const prefix = colon < 0 ? '' : path.slice(0, colon)
  const label = (colon < 0 ? path : path.slice(colon + 1)).trim()
  return { secret, algorithm, digits, period, issuer: (given ?? prefix).trim(), label }
}

export function totpIn(text: string): Totp | null {
  const trimmed = text.trim()
  if (/^otpauth:/i.test(trimmed)) return uriIn(trimmed)
  const secret = secretIn(trimmed, BARE_LEAST)
  if (secret === null) return null
  return { secret, algorithm: 'SHA1', digits: 6, period: 30, issuer: '', label: '' }
}

export function totpUri(totp: Totp): string {
  const name = encodeURIComponent(totp.label)
  const path = totp.issuer === '' ? name : `${encodeURIComponent(totp.issuer)}:${name}`
  const query = new URLSearchParams({ secret: totp.secret })
  if (totp.issuer !== '') query.set('issuer', totp.issuer)
  query.set('algorithm', totp.algorithm)
  query.set('digits', String(totp.digits))
  query.set('period', String(totp.period))
  return `otpauth://totp/${path}?${query.toString()}`
}

export async function code(totp: Totp, nowMs: number): Promise<TotpCode> {
  const seconds = Math.floor(nowMs / 1000)
  const counter = Math.floor(seconds / totp.period)
  const message = new Uint8Array(8)
  const view = new DataView(message.buffer)
  view.setUint32(0, Math.floor(counter / 2 ** 32))
  view.setUint32(4, counter >>> 0)
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    unbase32(totp.secret),
    { name: 'HMAC', hash: HASHES[totp.algorithm] },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, message))
  const offset = (mac[mac.length - 1] ?? 0) & 15
  const binary = new DataView(mac.buffer).getUint32(offset) & 0x7fffffff
  return {
    code: String(binary % 10 ** totp.digits).padStart(totp.digits, '0'),
    remaining: totp.period - (seconds % totp.period),
  }
}
