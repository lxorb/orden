import type { Env } from '../types'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const TAIL = 4

const SHORTEST = 20
const LONGEST = 200

const SALT = 'nib/openai-key/v1'

export interface KeyState {
  set: boolean
  tail: string
}

const VERSION = '1'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += String.fromCharCode(byte)
  return btoa(out)
}

function bytes(text: string): Uint8Array {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let at = 0; at < raw.length; at++) out[at] = raw.charCodeAt(at)
  return out
}

async function under(secret: string, userId: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ])

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      info: encoder.encode(userId),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function sealed(
  secret: string,
  userId: string,
  key: string,
  salt: string = SALT,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const sealedBytes = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(userId) },
    await under(secret, userId, salt),
    encoder.encode(key),
  )

  return `${VERSION}.${base64(nonce)}.${base64(new Uint8Array(sealedBytes))}`
}

export async function opened(
  secret: string,
  userId: string,
  stored: string,
  salt: string = SALT,
): Promise<string | null> {
  const [version, nonce, body] = stored.split('.')
  if (version !== VERSION || !nonce || !body) return null

  try {
    const open = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(nonce), additionalData: encoder.encode(userId) },
      await under(secret, userId, salt),
      bytes(body),
    )
    return decoder.decode(open)
  } catch {
    return null
  }
}

export function mayStore(env: Env): boolean {
  return !!env.OPENAI_KEY_SECRET
}

export async function keyState(env: Env, userId: string): Promise<KeyState> {
  const row = await env.DB.prepare('select openai_key_tail as tail from users where id = ?')
    .bind(userId)
    .first<{ tail: string | null }>()

  const tail = row?.tail ?? ''
  return { set: !!tail, tail }
}

export async function keyFor(env: Env, userId: string): Promise<string | null> {
  const secret = env.OPENAI_KEY_SECRET
  if (!secret) return null

  const row = await env.DB.prepare('select openai_key as sealed from users where id = ?')
    .bind(userId)
    .first<{ sealed: string | null }>()

  const stored = row?.sealed
  return stored ? opened(secret, userId, stored) : null
}

export async function setKey(env: Env, userId: string, given: string): Promise<KeyState | string> {
  const secret = env.OPENAI_KEY_SECRET
  if (!secret) return 'this server cannot keep a key yet'

  const key = given.trim()
  if (key.length < SHORTEST || key.length > LONGEST) return 'that does not look like a key'
  if (/\s/.test(key)) return 'that does not look like a key'

  await env.DB.prepare('update users set openai_key = ?, openai_key_tail = ? where id = ?')
    .bind(await sealed(secret, userId, key), key.slice(-TAIL), userId)
    .run()

  return { set: true, tail: key.slice(-TAIL) }
}

export async function forgetKey(env: Env, userId: string): Promise<KeyState> {
  await env.DB.prepare('update users set openai_key = null, openai_key_tail = null where id = ?')
    .bind(userId)
    .run()

  return { set: false, tail: '' }
}
