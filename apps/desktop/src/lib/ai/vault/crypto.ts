/** The arithmetic of carrying AI accounts end to end between a reader's devices: no
 *  store, no request, so all of it is tested on its own (docs/ai.md, "Every device").
 *
 *  Three kinds of key, the shape web logins have (docs/sync-v2.md 6.6), in what every
 *  webview's WebCrypto has - a desktop's, a phone's and a browser's alike:
 *
 *  - **a device key**: an ECDH P-256 key pair per device. The public half is what the
 *    account knows the device by; the private half stays in the device's own secret
 *    store (keys.ts).
 *  - **the vault key**: 32 random bytes, the same on every allowed device, which the
 *    account holds only **wrapped** to one device's public key: an ephemeral key pair
 *    per wrap, HKDF-SHA256 over the shared secret with both public keys as salt, and
 *    AES-256-GCM. The output is `ephemeral public key || nonce || ciphertext`.
 *  - **the vault**: the accounts and their keys as JSON, AES-256-GCM under the vault key
 *    with a random nonce and a fixed label as associated data.
 *
 *  And the six digits two screens compare while a device is allowed, from the new
 *  device's public key: a server that swapped in a key of its own would show different
 *  ones. */

const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const
const WRAP_INFO = new TextEncoder().encode('nib ai vault key')
const SEAL_LABEL = new TextEncoder().encode('nib ai vault 1')
const NONCE = 12
/** An uncompressed P-256 public key's length. */
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

/** A device's key pair as it is kept: the private half as JWK, the public half raw. */
export interface DeviceKey {
  /** The id the account files the device under: hex of the public key's hash. */
  id: string
  pub: string
  priv: JsonWebKey
}

async function hex(bytes: Uint8Array<ArrayBuffer>, length: number): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', bytes))
  return [...digest.slice(0, length)].map((one) => one.toString(16).padStart(2, '0')).join('')
}

/** A fresh device key. */
export async function newDeviceKey(): Promise<DeviceKey> {
  const pair = await subtle().generateKey(CURVE, true, ['deriveBits'])
  const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey))
  return {
    id: await hex(pub, 16),
    pub: base64(pub),
    priv: await subtle().exportKey('jwk', pair.privateKey),
  }
}

/** A kept device key, read rather than trusted. */
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

/** The six digits both screens show for a device's public key, `SHA-256(pub)` read as
 *  a number, mod 10^6, in two groups of three. */
export async function digits(pub: string): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', bytesOf(pub)))
  let number = 0
  for (const one of digest.slice(0, 6)) number = (number * 256 + one) % 1_000_000
  const six = String(number).padStart(6, '0')
  return `${six.slice(0, 3)} ${six.slice(3)}`
}

/** A fresh vault key. */
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

/** The vault key wrapped to the device whose public key is `to`. */
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

/** The vault key out of a wrap made to this device; throws where it was not. */
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

async function vaultKey(key: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return await subtle().importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** Words sealed under the vault key. */
export async function seal(key: Uint8Array<ArrayBuffer>, text: string): Promise<string> {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE))
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: SEAL_LABEL },
    await vaultKey(key),
    new TextEncoder().encode(text),
  )
  return base64(joined(nonce, new Uint8Array(sealed)))
}

/** The words out of a sealed vault; throws where the key is not the one it was sealed
 *  with, or a byte of it changed. */
export async function open(key: Uint8Array<ArrayBuffer>, sealed: string): Promise<string> {
  const all = bytesOf(sealed)
  const opened = await subtle().decrypt(
    { name: 'AES-GCM', iv: all.slice(0, NONCE), additionalData: SEAL_LABEL },
    await vaultKey(key),
    all.slice(NONCE),
  )
  return new TextDecoder().decode(opened)
}

/** A short fingerprint of a secret, so a device can tell whether a key changed without
 *  keeping the key: what the last synced contents remember instead. */
export async function fingerprint(secret: string): Promise<string> {
  return await hex(new TextEncoder().encode(`nib ai vault ${secret}`), 16)
}
