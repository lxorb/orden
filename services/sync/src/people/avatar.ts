import { objectIn } from '../body'

export interface Avatar {
  s: string
  l: string
}

const HASH = /^[a-f0-9]{64}$/

export function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value)
}

export function avatarIn(raw: string | null): Avatar | null {
  const held = objectIn(raw)
  return held && isHash(held.s) && isHash(held.l) ? { s: held.s, l: held.l } : null
}
