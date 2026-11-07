import { writtenKdfIn } from './kdf'
import { isBase64, isSignPub } from './shape'

export interface PasswordSeal {
  salt: string
  m: number
  t: number
  p: number
  sealed: string
  at?: number
}

export interface SignSeal {
  pub: string
  private: string
}

export interface Keyring {
  v: 1
  pub: string
  private: string
  sign?: SignSeal
  password: PasswordSeal
  recovery: string | null
  at: number
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function passwordSealIn(value: unknown): PasswordSeal | null {
  const params = writtenKdfIn(value)
  if (params === null) return null
  const { salt, sealed, at } = value as Record<string, unknown>
  if (!isBase64(salt, 8) || !isBase64(sealed, 1)) return null
  if (at === undefined) return { salt, ...params, sealed }
  return isTime(at) ? { salt, ...params, sealed, at } : null
}

function signSealIn(value: unknown): SignSeal | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { pub, private: sealed } = value as Record<string, unknown>
  return isSignPub(pub) && isBase64(sealed, 1) ? { pub, private: sealed } : null
}

export function keyringIn(value: unknown): Keyring | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const password = passwordSealIn(raw.password)
  const sign = signSealIn(raw.sign)
  if (
    raw.v !== 1 ||
    !isBase64(raw.pub, 1) ||
    !isBase64(raw.private, 1) ||
    password === null ||
    sign === null ||
    !(raw.recovery === null || isBase64(raw.recovery, 1)) ||
    typeof raw.at !== 'number' ||
    !Number.isFinite(raw.at)
  )
    return null
  const keyring: Keyring = {
    v: 1,
    pub: raw.pub,
    private: raw.private,
    password,
    recovery: raw.recovery,
    at: raw.at,
  }
  return sign === undefined ? keyring : { ...keyring, sign }
}
