const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const
const WRAP_INFO = new TextEncoder().encode('nib ai vault key')
const AUTH_INFO = new TextEncoder().encode('nib ai vault auth')
const SEAL_LABEL = new TextEncoder().encode('nib ai vault 1')
const NONCE = 12
const POINT = 65

const subtle = (): SubtleCrypto => globalThis.crypto.subtle

function base64(bytes: Uint8Array): string {
  let text = ''
  for (const one of bytes) text += String.fromCharCode(one)
  return btoa(text)
}

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let at = 0; at < raw.length; at++) bytes[at] = raw.charCodeAt(at)
  return bytes
}

export interface DeviceKey {
  id: string
  pub: string
  priv: JsonWebKey
}

async function hex(bytes: Uint8Array<ArrayBuffer>, length: number): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', bytes))
  return [...digest.slice(0, length)].map((one) => one.toString(16).padStart(2, '0')).join('')
}

export async function idOf(pub: string): Promise<string> {
  return await hex(bytesOf(pub), 16)
}

export async function newDeviceKey(): Promise<DeviceKey> {
  const pair = await subtle().generateKey(CURVE, true, ['deriveBits'])
  const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey))
  return {
    id: await hex(pub, 16),
    pub: base64(pub),
    priv: await subtle().exportKey('jwk', pair.privateKey),
  }
}

export function deviceKeyIn(value: unknown): DeviceKey | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, pub, priv } = value as Record<string, unknown>
  return typeof id === 'string' &&
    /^[a-f0-9]{32}$/.test(id) &&
    typeof pub === 'string' &&
    typeof priv === 'object' &&
    priv !== null
    ? { id, pub, priv }
    : null
}

export function newVaultKey(): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(32))
}

async function wrapping(
  secret: CryptoKey,
  them: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const shared = await subtle().deriveBits({ name: 'ECDH', public: them }, secret, 256)
  const material = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return await subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: WRAP_INFO },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function joined(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const all = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0))
  let at = 0
  for (const one of parts) {
    all.set(one, at)
    at += one.length
  }
  return all
}

export async function wrap(key: Uint8Array<ArrayBuffer>, to: string): Promise<string> {
  const target = bytesOf(to)
  const them = await subtle().importKey('raw', target, CURVE, false, [])
  const once = await subtle().generateKey(CURVE, true, ['deriveBits'])
  const ephemeral = new Uint8Array(await subtle().exportKey('raw', once.publicKey))
  const sealing = await wrapping(once.privateKey, them, joined(ephemeral, target))
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE))
  const sealed = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, sealing, key),
  )
  return base64(joined(ephemeral, nonce, sealed))
}

export async function unwrap(wrapped: string, mine: DeviceKey): Promise<Uint8Array<ArrayBuffer>> {
  const all = bytesOf(wrapped)
  const ephemeral = all.slice(0, POINT)
  const nonce = all.slice(POINT, POINT + NONCE)
  const sealed = all.slice(POINT + NONCE)
  const secret = await subtle().importKey('jwk', mine.priv, CURVE, false, ['deriveBits'])
  const them = await subtle().importKey('raw', ephemeral, CURVE, false, [])
  const sealing = await wrapping(secret, them, joined(ephemeral, bytesOf(mine.pub)))
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: nonce }, sealing, sealed))
}

export async function authOf(key: Uint8Array<ArrayBuffer>): Promise<string> {
  const material = await subtle().importKey('raw', key, 'HKDF', false, ['deriveBits'])
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: AUTH_INFO },
    material,
    256,
  )
  return base64(new Uint8Array(bits))
}

async function vaultKey(key: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return await subtle().importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function seal(key: Uint8Array<ArrayBuffer>, text: string): Promise<string> {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE))
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: SEAL_LABEL },
    await vaultKey(key),
    new TextEncoder().encode(text),
  )
  return base64(joined(nonce, new Uint8Array(sealed)))
}

export async function open(key: Uint8Array<ArrayBuffer>, sealed: string): Promise<string> {
  const all = bytesOf(sealed)
  const opened = await subtle().decrypt(
    { name: 'AES-GCM', iv: all.slice(0, NONCE), additionalData: SEAL_LABEL },
    await vaultKey(key),
    all.slice(NONCE),
  )
  return new TextDecoder().decode(opened)
}

export async function fingerprint(secret: string): Promise<string> {
  return await hex(new TextEncoder().encode(`nib ai vault ${secret}`), 16)
}
