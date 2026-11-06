import { invoke, isNative } from './tauri'

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  return bytes
}

export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''

  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK))
  }

  return btoa(binary)
}

export async function sha256(data: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as Uint8Array<ArrayBuffer> | ArrayBuffer,
  )

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function parseDataUri(uri: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(uri)
  if (!match) return null

  const mime = match[1] === '' ? 'application/octet-stream' : (match[1] ?? '')
  const body = match[3] ?? ''

  return { mime, bytes: match[2] ? fromBase64(body) : new TextEncoder().encode(decodeURI(body)) }
}

export async function fileBytes(path: string): Promise<Uint8Array> {
  if (isNative) return new Uint8Array(await invoke<ArrayBuffer>('read_file', { path }))

  const uri = await invoke<string>('read_asset', { path })
  return parseDataUri(uri)?.bytes ?? new Uint8Array()
}
