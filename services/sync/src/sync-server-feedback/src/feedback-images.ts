export const MOST_IMAGES = 4
const MOST_IMAGE_BYTES = 1_000_000

export const MOST_DATA_URL = Math.ceil(MOST_IMAGE_BYTES / 3) * 4 + 64

export type PictureType = 'image/png' | 'image/jpeg'

export interface Picture {
  type: PictureType
  bytes: Uint8Array
}

export function pictureKey(report: string, name: string): string {
  return `feedback/${report}/${name}`
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function sniffed(bytes: Uint8Array): PictureType | null {
  if (PNG_SIGNATURE.every((byte, at) => bytes[at] === byte)) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

export function pictureOf(said: string): Picture | string {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(said)
  const type = match?.[1] as PictureType | undefined
  const data = match?.[2]
  if (!type || data === undefined) return 'an image must be a PNG or a JPEG'

  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(data), (letter) => letter.charCodeAt(0))
  } catch {
    return 'an image could not be read'
  }
  if (bytes.length > MOST_IMAGE_BYTES) return 'an image may be at most 1 MB'
  if (sniffed(bytes) !== type) return 'an image is not what it says it is'

  const clean = type === 'image/png' ? pngWithout(bytes) : jpegWithout(bytes)
  return clean ? { type, bytes: clean } : 'an image could not be read'
}

const PNG_WORDS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])

export function pngWithout(bytes: Uint8Array): Uint8Array | null {
  const kept: Uint8Array[] = [bytes.subarray(0, 8)]
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at)
    const end = at + 12 + length
    if (end > bytes.length) return null
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    if (!PNG_WORDS.has(type)) kept.push(bytes.subarray(at, end))
    at = end
    if (type === 'IEND') return joined(kept)
  }
  return null
}

function keptSegment(marker: number): boolean {
  if (marker === 0xfe) return false
  if (marker < 0xe0 || marker > 0xef) return true
  return marker === 0xe0 || marker === 0xe2 || marker === 0xee
}

export function jpegWithout(bytes: Uint8Array): Uint8Array | null {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1] ?? 0
    if (marker === 0xff) {
      at++
      continue
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
    if (length < 2) return null
    const end = at + 2 + length
    if (end > bytes.length) return null
    if (marker === 0xda) {
      kept.push(bytes.subarray(at))
      return joined(kept)
    }
    if (keptSegment(marker)) kept.push(bytes.subarray(at, end))
    at = end
  }
  return null
}

function joined(parts: readonly Uint8Array[]): Uint8Array {
  const whole = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.length
  }
  return whole
}
