import { Buffer } from 'buffer'
import { cbc, ctr, gcm } from '@noble/ciphers/aes.js'
import { hmac } from '@noble/hashes/hmac.js'
import { md5, sha1 } from '@noble/hashes/legacy.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'

type Bytes = Uint8Array
type Data = Bytes | string

const HASHES = { sha256, sha512, sha1, md5 }

function hashOf(name: string): (typeof HASHES)[keyof typeof HASHES] {
  const key = name.toLowerCase().replace('-', '')
  if (!(key in HASHES)) throw new Error(`${name} is not a hash this build has`)
  return HASHES[key as keyof typeof HASHES]
}

function bytesOf(data: Data, encoding?: BufferEncoding): Bytes {
  return typeof data === 'string' ? Buffer.from(data, encoding ?? 'utf8') : data
}

function out(bytes: Bytes, encoding?: BufferEncoding): Buffer | string {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return encoding ? buffer.toString(encoding) : buffer
}

export function randomBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size)
  for (let at = 0; at < size; at += 65536)
    crypto.getRandomValues(bytes.subarray(at, Math.min(size, at + 65536)))
  return bytes
}

export function randomInt(min: number, max?: number): number {
  const [low, high] = max === undefined ? [0, min] : [min, max]
  const span = high - low
  const [word = 0] = crypto.getRandomValues(new Uint32Array(1))
  return low + (word % span)
}

export function createHash(name: string) {
  const state = hashOf(name).create()
  const made = {
    update(data: Data, encoding?: BufferEncoding) {
      state.update(bytesOf(data, encoding))
      return made
    },
    digest: (encoding?: BufferEncoding) => out(state.digest(), encoding),
    destroy: () => undefined,
  }
  return made
}

export function createHmac(name: string, key: Data) {
  const state = hmac.create(hashOf(name), bytesOf(key))
  const made = {
    update(data: Data, encoding?: BufferEncoding) {
      state.update(bytesOf(data, encoding))
      return made
    },
    digest: (encoding?: BufferEncoding) => out(state.digest(), encoding),
    destroy: () => undefined,
  }
  return made
}

function cipher(name: string, key: Bytes, iv: Bytes, encrypting: boolean) {
  const kind = name.toLowerCase()
  if (!['aes-256-gcm', 'aes-256-cbc', 'aes-256-ctr'].includes(kind))
    throw new Error(`${name} is not a cipher this build has`)
  const parts: Bytes[] = []
  let aad: Bytes | undefined
  let tag: Bytes | undefined
  let padding = true
  let finished: Bytes | null = null
  const made = {
    setAAD(data: Bytes) {
      aad = data
      return made
    },
    setAuthTag(data: Bytes) {
      tag = data
      return made
    },
    setAutoPadding(on = true) {
      padding = on
      return made
    },
    getAuthTag(): Buffer {
      if (!tag) throw new Error('the cipher has not finished')
      return Buffer.from(tag)
    },
    update(data: Data, encoding?: BufferEncoding): Buffer {
      parts.push(bytesOf(data, encoding))
      return Buffer.alloc(0)
    },
    final(): Buffer {
      if (finished) throw new Error('the cipher has already finished')
      const all = Buffer.concat(parts)
      if (kind === 'aes-256-gcm') {
        const aes = gcm(key, iv, aad)
        if (encrypting) {
          const sealed = aes.encrypt(all)
          tag = sealed.subarray(sealed.length - 16)
          finished = sealed.subarray(0, sealed.length - 16)
        } else {
          if (!tag) throw new Error('no authentication tag')
          finished = aes.decrypt(Buffer.concat([all, tag]))
        }
      } else if (kind === 'aes-256-cbc') {
        const aes = cbc(key, iv, { disablePadding: !padding })
        finished = encrypting ? aes.encrypt(all) : aes.decrypt(all)
      } else {
        const aes = ctr(key, iv)
        finished = encrypting ? aes.encrypt(all) : aes.decrypt(all)
      }
      return Buffer.from(finished)
    },
    destroy: () => undefined,
  }
  return made
}

export function createCipheriv(name: string, key: Bytes, iv: Bytes) {
  return cipher(name, key, iv, true)
}

export function createDecipheriv(name: string, key: Bytes, iv: Bytes) {
  return cipher(name, key, iv, false)
}

export function generateKeyPairSync(): never {
  throw new Error('generated in JavaScript instead')
}

export default {
  randomBytes,
  randomInt,
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
}
