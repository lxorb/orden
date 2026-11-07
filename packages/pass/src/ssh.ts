import { base64, fromUtf8, joined, randomBytes, unbase64, utf8 } from './bytes'

export interface SshPair {
  publicKey: string
  privateKey: string
}

const ED25519 = 'ssh-ed25519'
const MAGIC = 'openssh-key-v1\0'
const BEGIN = '-----BEGIN OPENSSH PRIVATE KEY-----'
const END = '-----END OPENSSH PRIVATE KEY-----'
const LINE = 70
const BLOCK = 8

const PRIVATE_FIELDS: Record<string, number> = {
  'ssh-ed25519': 2,
  'ssh-rsa': 6,
  'ssh-dss': 5,
  'ecdsa-sha2-nistp256': 3,
  'ecdsa-sha2-nistp384': 3,
  'ecdsa-sha2-nistp521': 3,
}

const subtle = (): SubtleCrypto => globalThis.crypto.subtle

function uint32(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

function sshString(value: Uint8Array | string): Uint8Array<ArrayBuffer> {
  const bytes = typeof value === 'string' ? utf8(value) : value
  return joined(uint32(bytes.length), bytes)
}

class Reader {
  private at = 0

  constructor(private readonly bytes: Uint8Array) {}

  uint32(): number {
    if (this.at + 4 > this.bytes.length) throw new Error('pass: short ssh key')
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.at, 4)
    this.at += 4
    return view.getUint32(0)
  }

  bytesOf(): Uint8Array {
    const length = this.uint32()
    if (this.at + length > this.bytes.length) throw new Error('pass: short ssh key')
    const out = this.bytes.subarray(this.at, this.at + length)
    this.at += length
    return out
  }

  text(): string {
    return fromUtf8(this.bytesOf())
  }

  raw(length: number): Uint8Array {
    if (this.at + length > this.bytes.length) throw new Error('pass: short ssh key')
    const out = this.bytes.subarray(this.at, this.at + length)
    this.at += length
    return out
  }

  rest(): Uint8Array {
    const out = this.bytes.subarray(this.at)
    this.at = this.bytes.length
    return out
  }
}

function pem(bytes: Uint8Array): string {
  const text = base64(bytes)
  const lines = text.match(new RegExp(`.{1,${String(LINE)}}`, 'g')) ?? []
  return `${BEGIN}\n${lines.join('\n')}\n${END}\n`
}

function unpem(text: string): Uint8Array | null {
  const start = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  if (start < 0 || end < start) return null
  const body = text.slice(start + BEGIN.length, end).replace(/\s+/g, '')
  try {
    return unbase64(body)
  } catch {
    return null
  }
}

function padded(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const extra = (BLOCK - (bytes.length % BLOCK)) % BLOCK
  return joined(
    bytes,
    Uint8Array.from({ length: extra }, (_, at) => at + 1),
  )
}

export function sshComment(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function lineOf(type: string, blob: Uint8Array, comment: string): string {
  const line = `${type} ${base64(blob)}`
  const clean = sshComment(comment)
  return clean === '' ? line : `${line} ${clean}`
}

function publicLine(blob: Uint8Array, comment: string): string | null {
  const type = new Reader(blob).text()
  return /^[A-Za-z0-9@.-]{1,64}$/.test(type) ? lineOf(type, blob, comment) : null
}

export async function canMakeSshKey(): Promise<boolean> {
  try {
    await subtle().generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    return true
  } catch {
    return false
  }
}

export async function newSshKey(comment: string): Promise<SshPair> {
  const pair = await subtle().generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey))
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey))
  const seed = pkcs8.slice(pkcs8.length - 32)
  if (pub.length !== 32 || seed.length !== 32) throw new Error('pass: unexpected Ed25519 key')
  const blob = joined(sshString(ED25519), sshString(pub))
  const check = randomBytes(4)
  const secret = padded(
    joined(
      check,
      check,
      sshString(ED25519),
      sshString(pub),
      sshString(joined(seed, pub)),
      sshString(sshComment(comment)),
    ),
  )
  const whole = joined(
    utf8(MAGIC),
    sshString('none'),
    sshString('none'),
    sshString(''),
    uint32(1),
    sshString(blob),
    sshString(secret),
  )
  return { publicKey: lineOf(ED25519, blob, comment), privateKey: pem(whole) }
}

export function sshPublicOf(privateKey: string): string | null {
  const bytes = unpem(privateKey)
  if (!bytes) return null
  try {
    const magic = utf8(MAGIC)
    const reader = new Reader(bytes)
    if (fromUtf8(reader.raw(magic.length)) !== MAGIC) return null
    const cipher = reader.text()
    reader.text()
    reader.bytesOf()
    if (reader.uint32() !== 1) return null
    const blob = reader.bytesOf()
    const secret = reader.bytesOf()
    if (cipher !== 'none') return publicLine(blob, '')
    const inner = new Reader(secret)
    if (inner.uint32() !== inner.uint32()) return null
    const type = inner.text()
    if (new Reader(blob).text() !== type) return null
    const fields = PRIVATE_FIELDS[type]
    if (fields === undefined) return publicLine(blob, '')
    for (let field = 0; field < fields; field++) inner.bytesOf()
    const comment = inner.text()
    const padding = inner.rest()
    if (padding.some((one, at) => one !== at + 1)) return null
    return publicLine(blob, comment)
  } catch {
    return null
  }
}

export async function sshFingerprint(publicKey: string): Promise<string | null> {
  const [type, encoded] = publicKey.trim().split(/\s+/)
  if (!type || !encoded) return null
  let blob: Uint8Array<ArrayBuffer>
  try {
    blob = unbase64(encoded)
    if (new Reader(blob).text() !== type) return null
  } catch {
    return null
  }
  const digest = new Uint8Array(await subtle().digest('SHA-256', blob))
  return `SHA256:${base64(digest).replace(/=+$/, '')}`
}
