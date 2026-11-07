import { argon2idAsync } from '@noble/hashes/argon2.js'
import { base64, fromUtf8, joined, randomBytes, unbase64, utf8 } from './bytes'
import { type KdfParams, kdfParamsIn } from './kdf'

export { KdfTooCostly, kdfParamsIn, PASSWORD_KDF, PIN_KDF, type KdfParams } from './kdf'

export type Label =
  | 'root'
  | 'private'
  | 'vault-key'
  | 'vault'
  | 'item-key'
  | 'item'
  | 'link'
  | 'file'
  | 'local'
  | 'export'
  | 'version'
  | 'sign'

export class WrongSecret extends Error {
  constructor(message = 'pass: wrong secret') {
    super(message)
    this.name = 'WrongSecret'
  }
}

const KEY = 32
const NONCE = 12
const TAG = 16
const POINT = 65
const SALT_MIN = 8
const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const

const subtle = (): SubtleCrypto => globalThis.crypto.subtle

export function newKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(KEY)
}

function contextOf(prefix: string, label: Label, context: string[]): Uint8Array<ArrayBuffer> {
  if (context.some((one) => one.includes('\n'))) throw new Error('pass: context holds a newline')
  return utf8(`${prefix}\n${label}\n${context.join('\n')}`)
}

async function aesKey(key: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (key.length !== KEY) throw new Error('pass: a key is 32 bytes')
  return await subtle().importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function plainBytes(plain: Uint8Array | string): Uint8Array<ArrayBuffer> {
  return typeof plain === 'string' ? utf8(plain) : joined(plain)
}

export async function sealBytes(
  key: Uint8Array<ArrayBuffer>,
  plain: Uint8Array | string,
  label: Label,
  ...context: string[]
): Promise<Uint8Array<ArrayBuffer>> {
  const additionalData = contextOf('orden pass 1', label, context)
  const sealing = await aesKey(key)
  const nonce = randomBytes(NONCE)
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData },
    sealing,
    plainBytes(plain),
  )
  return joined(nonce, new Uint8Array(sealed))
}

export async function seal(
  key: Uint8Array<ArrayBuffer>,
  plain: Uint8Array | string,
  label: Label,
  ...context: string[]
): Promise<string> {
  return base64(await sealBytes(key, plain, label, ...context))
}

function sealedBytes(sealed: string, least: number): Uint8Array<ArrayBuffer> {
  let all: Uint8Array<ArrayBuffer>
  try {
    all = unbase64(sealed)
  } catch {
    throw new WrongSecret()
  }
  if (all.length < least) throw new WrongSecret()
  return all
}

export async function openBytes(
  key: Uint8Array<ArrayBuffer>,
  all: Uint8Array<ArrayBuffer>,
  label: Label,
  ...context: string[]
): Promise<Uint8Array<ArrayBuffer>> {
  if (all.length < NONCE + TAG) throw new WrongSecret()
  const additionalData = contextOf('orden pass 1', label, context)
  const opening = await aesKey(key)
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: 'AES-GCM', iv: all.slice(0, NONCE), additionalData },
        opening,
        all.subarray(NONCE),
      ),
    )
  } catch {
    throw new WrongSecret()
  }
}

export async function open(
  key: Uint8Array<ArrayBuffer>,
  sealed: string,
  label: Label,
  ...context: string[]
): Promise<Uint8Array<ArrayBuffer>> {
  return await openBytes(key, sealedBytes(sealed, NONCE + TAG), label, ...context)
}

export async function openText(
  key: Uint8Array<ArrayBuffer>,
  sealed: string,
  label: Label,
  ...context: string[]
): Promise<string> {
  const opened = await open(key, sealed, label, ...context)
  try {
    return fromUtf8(opened)
  } catch {
    throw new WrongSecret()
  }
}

export async function subkey(
  key: Uint8Array<ArrayBuffer>,
  info: string | Uint8Array,
  salt: Uint8Array<ArrayBuffer> = new Uint8Array(0),
): Promise<Uint8Array<ArrayBuffer>> {
  const material = await subtle().importKey('raw', key, 'HKDF', false, ['deriveBits'])
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: plainBytes(info) },
    material,
    KEY * 8,
  )
  return new Uint8Array(bits)
}

export type Stretcher = (
  secret: string,
  salt: Uint8Array,
  params: KdfParams,
) => Promise<Uint8Array<ArrayBuffer>>

let stretcher: Stretcher | null = null

export function useStretcher(next: Stretcher | null): void {
  stretcher = next
}

export async function stretch(
  secret: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array<ArrayBuffer>> {
  const checked = kdfParamsIn(params)
  if (checked === null) throw new WrongSecret('pass: key stretching parameters out of range')
  if (salt.length < SALT_MIN) throw new WrongSecret('pass: salt too short')
  const normal = secret.normalize('NFC')
  if (stretcher) {
    const quick = await stretcher(normal, salt, checked)
    if (quick.length !== KEY) throw new Error('pass: the stretcher answered the wrong length')
    return quick
  }
  const stretched = await argon2idAsync(utf8(normal), salt, {
    ...checked,
    dkLen: KEY,
    maxmem: (checked.m + 1024) * 1024,
  })
  return joined(stretched)
}

export interface Pair {
  pub: string
  priv: JsonWebKey
}

export async function newPair(): Promise<Pair> {
  const pair = await subtle().generateKey(CURVE, true, ['deriveBits'])
  return {
    pub: base64(new Uint8Array(await subtle().exportKey('raw', pair.publicKey))),
    priv: await subtle().exportKey('jwk', pair.privateKey),
  }
}

async function wrapping(
  secret: CryptoKey,
  them: CryptoKey,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const shared = await subtle().deriveBits({ name: 'ECDH', public: them }, secret, 256)
  const material = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return await subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function wrapTo(
  key: Uint8Array<ArrayBuffer>,
  pub: string,
  label: Label,
  ...context: string[]
): Promise<string> {
  const info = contextOf('orden pass wrap', label, context)
  if (key.length !== KEY) throw new Error('pass: a key is 32 bytes')
  const target = unbase64(pub)
  const them = await subtle().importKey('raw', target, CURVE, false, [])
  const once = await subtle().generateKey(CURVE, true, ['deriveBits'])
  const ephemeral = new Uint8Array(await subtle().exportKey('raw', once.publicKey))
  const sealing = await wrapping(once.privateKey, them, joined(ephemeral, target), info)
  const nonce = randomBytes(NONCE)
  const sealed = await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, sealing, key)
  return base64(joined(ephemeral, nonce, new Uint8Array(sealed)))
}

export async function unwrapWith(
  wrapped: string,
  pair: Pair,
  label: Label,
  ...context: string[]
): Promise<Uint8Array<ArrayBuffer>> {
  const info = contextOf('orden pass wrap', label, context)
  const all = sealedBytes(wrapped, POINT + NONCE + TAG)
  try {
    const ephemeral = all.slice(0, POINT)
    const secret = await subtle().importKey('jwk', pair.priv, CURVE, false, ['deriveBits'])
    const them = await subtle().importKey('raw', ephemeral, CURVE, false, [])
    const opening = await wrapping(secret, them, joined(ephemeral, unbase64(pair.pub)), info)
    return new Uint8Array(
      await subtle().decrypt(
        { name: 'AES-GCM', iv: all.slice(POINT, POINT + NONCE) },
        opening,
        all.slice(POINT + NONCE),
      ),
    )
  } catch {
    throw new WrongSecret()
  }
}

export async function fingerprintOf(pub: string): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', unbase64(pub)))
  const hex = [...digest.slice(0, 16)].map((one) => one.toString(16).padStart(2, '0')).join('')
  return hex.match(/.{4}/g)?.join(' ') ?? hex
}
