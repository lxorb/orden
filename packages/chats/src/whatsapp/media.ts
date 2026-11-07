export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker'

const INFO: Readonly<Record<MediaKind, string>> = {
  image: 'WhatsApp Image Keys',
  sticker: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
}

const PATH: Readonly<Record<MediaKind, string>> = {
  image: '/mms/image',
  sticker: '/mms/image',
  video: '/mms/video',
  audio: '/mms/audio',
  document: '/mms/document',
}

const MEDIA_HOST = 'mmg.whatsapp.net'

const MAC = 10

interface Keys {
  iv: Uint8Array<ArrayBuffer>
  cipher: CryptoKey
  mac: CryptoKey
}

function copied(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes)
}

async function keysOf(mediaKey: Uint8Array, kind: MediaKind): Promise<Keys> {
  const base = await crypto.subtle.importKey('raw', copied(mediaKey), 'HKDF', false, ['deriveBits'])
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(32),
        info: new TextEncoder().encode(INFO[kind]),
      },
      base,
      112 * 8,
    ),
  )
  return {
    iv: bits.slice(0, 16),
    cipher: await crypto.subtle.importKey('raw', bits.slice(16, 48), 'AES-CBC', false, [
      'encrypt',
      'decrypt',
    ]),
    mac: await crypto.subtle.importKey(
      'raw',
      bits.slice(48, 80),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    ),
  }
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', copied(bytes)))
}

function joined(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0))
  let at = 0
  for (const one of parts) {
    out.set(one, at)
    at += one.length
  }
  return out
}

async function macOf(keys: Keys, encrypted: Uint8Array): Promise<Uint8Array> {
  const signed = await crypto.subtle.sign('HMAC', keys.mac, joined(keys.iv, encrypted))
  return new Uint8Array(signed).slice(0, MAC)
}

export interface Sealed {
  mediaKey: Uint8Array
  body: Uint8Array
  fileSha256: Uint8Array
  fileEncSha256: Uint8Array
  fileLength: number
}

export async function sealMedia(plain: Uint8Array, kind: MediaKind): Promise<Sealed> {
  const mediaKey = crypto.getRandomValues(new Uint8Array(32))
  const keys = await keysOf(mediaKey, kind)
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: keys.iv }, keys.cipher, copied(plain)),
  )
  const body = joined(encrypted, await macOf(keys, encrypted))
  return {
    mediaKey,
    body,
    fileSha256: await sha256(plain),
    fileEncSha256: await sha256(body),
    fileLength: plain.length,
  }
}

export async function openMedia(
  body: Uint8Array,
  mediaKey: Uint8Array,
  kind: MediaKind,
): Promise<Uint8Array> {
  if (body.length <= MAC) throw new Error('The file is damaged')
  const keys = await keysOf(mediaKey, kind)
  const encrypted = body.subarray(0, body.length - MAC)
  const mac = await macOf(keys, encrypted)
  const sent = body.subarray(body.length - MAC)
  if (mac.some((one, at) => one !== sent[at])) throw new Error('The file is damaged')
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-CBC', iv: keys.iv }, keys.cipher, copied(encrypted)),
  )
}

function base64(bytes: Uint8Array): string {
  let text = ''
  for (const one of bytes) text += String.fromCharCode(one)
  return btoa(text)
}

export function uploadToken(fileEncSha256: Uint8Array): string {
  return base64(fileEncSha256).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface MediaConn {
  hosts: readonly { hostname: string }[]
  auth: string
}

export interface Uploaded {
  url: string
  directPath: string
}

export async function upload(
  fetcher: typeof fetch,
  conn: MediaConn,
  sealed: Sealed,
  kind: MediaKind,
): Promise<Uploaded> {
  const token = uploadToken(sealed.fileEncSha256)
  let last: unknown = new Error('WhatsApp did not take the file')
  for (const { hostname } of conn.hosts) {
    try {
      const answer = await fetcher(
        `https://${hostname}${PATH[kind]}/${token}?auth=${encodeURIComponent(conn.auth)}&token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: copied(sealed.body),
        },
      )
      const said = (await answer.json()) as { url?: unknown; direct_path?: unknown }
      if (answer.ok && typeof said.url === 'string' && typeof said.direct_path === 'string')
        return { url: said.url, directPath: said.direct_path }
      last = new Error(`WhatsApp did not take the file (${answer.status})`)
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

function mediaUrl(found: { url?: string | null; directPath?: string | null }): string {
  if (found.directPath) return `https://${MEDIA_HOST}${found.directPath}`
  if (found.url) return found.url
  throw new Error('That file is no longer on WhatsApp')
}

export class Expired extends Error {}

export async function download(
  fetcher: typeof fetch,
  found: { url?: string | null; directPath?: string | null; mediaKey?: Uint8Array | null },
  kind: MediaKind,
): Promise<Uint8Array> {
  if (!found.mediaKey) throw new Error('That file is no longer on WhatsApp')
  const answer = await fetcher(mediaUrl(found))
  if (answer.status === 404 || answer.status === 410)
    throw new Expired('That file is no longer on WhatsApp')
  if (!answer.ok) throw new Error(`WhatsApp did not hand over the file (${answer.status})`)
  return openMedia(new Uint8Array(await answer.arrayBuffer()), found.mediaKey, kind)
}
