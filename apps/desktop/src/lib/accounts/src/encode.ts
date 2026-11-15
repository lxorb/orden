import { sourceSquare, turned, type Crop } from './crop'

const SMALL = 96
const LARGE = 512
const MOST_BYTES = 100 * 1024
const LONGEST = 2048

export interface Encoded {
  bytes: ArrayBuffer
  type: 'image/webp' | 'image/jpeg'
}

export function decode(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

export function prepared(picture: ImageBitmap, turns: number): HTMLCanvasElement {
  const shrink = Math.min(1, LONGEST / Math.max(picture.width, picture.height))
  const width = Math.round(picture.width * shrink)
  const height = Math.round(picture.height * shrink)
  const [outWidth, outHeight] = turned(width, height, turns)

  const canvas = document.createElement('canvas')
  canvas.width = outWidth
  canvas.height = outHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.translate(outWidth / 2, outHeight / 2)
  context.rotate((turns % 4) * (Math.PI / 2))
  context.drawImage(picture, -width / 2, -height / 2, width, height)
  return canvas
}

export async function faceFrom(
  picture: HTMLCanvasElement,
  crop: Crop,
  view: number,
): Promise<{ s: Encoded; l: Encoded }> {
  const square = sourceSquare(crop, picture.width, picture.height, view)
  const [s, l] = await Promise.all(
    [SMALL, LARGE].map((size) => encodedSmall(drawn(picture, square, size))),
  )
  if (!s || !l) throw new Error('no picture')
  return { s, l }
}

function drawn(
  picture: HTMLCanvasElement,
  square: { left: number; top: number; side: number },
  size: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.imageSmoothingQuality = 'high'
  context.drawImage(picture, square.left, square.top, square.side, square.side, 0, 0, size, size)
  return canvas
}

async function encodedSmall(canvas: HTMLCanvasElement): Promise<Encoded> {
  for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5]) {
    const webp = await blobOf(canvas, 'image/webp', quality)
    const kept = webp?.type === 'image/webp' ? webp : await blobOf(canvas, 'image/jpeg', quality)
    if (!kept) break
    const bytes = withoutMetadata(new Uint8Array(await kept.arrayBuffer()))
    if (bytes.byteLength > MOST_BYTES) continue
    if (carriesMetadata(bytes)) throw new Error('a picture kept its metadata')
    return { bytes: bytes.buffer, type: kept.type === 'image/webp' ? 'image/webp' : 'image/jpeg' }
  }
  throw new Error('that picture is too big')
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((done) => {
    canvas.toBlob(done, type, quality)
  })
}

const WEBP_METADATA = ['EXIF', 'XMP ']
const VP8X_METADATA_FLAGS = 0x08 | 0x04
const JPEG_COMMENT = 0xfe
const JPEG_SCAN = 0xda
const JPEG_KEPT_APPS = new Map([
  [0xe0, ''],
  [0xe2, 'ICC_PROFILE\0'],
  [0xee, 'Adobe'],
])

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length))
}

function le32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16) |
      ((bytes[at + 3] ?? 0) << 24)) >>>
    0
  )
}

function be16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)
}

function isWebp(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP'
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8
}

function joined(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const whole = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.length
  }
  return whole
}

function webpWithoutMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const kept: Uint8Array[] = [bytes.subarray(0, 12)]
  let at = 12
  while (at + 8 <= bytes.length) {
    const name = ascii(bytes, at, 4)
    const size = le32(bytes, at + 4)
    const end = Math.min(bytes.length, at + 8 + size + (size % 2))
    if (name === 'VP8X') {
      const chunk = bytes.slice(at, end)
      chunk[8] = (chunk[8] ?? 0) & ~VP8X_METADATA_FLAGS
      kept.push(chunk)
    } else if (!WEBP_METADATA.includes(name)) {
      kept.push(bytes.subarray(at, end))
    }
    at = end
  }
  kept.push(bytes.subarray(at))
  const whole = joined(kept)
  new DataView(whole.buffer).setUint32(4, whole.length - 8, true)
  return whole
}

function isJpegMetadata(marker: number, body: Uint8Array): boolean {
  if (marker === JPEG_COMMENT) return true
  if (marker < 0xe0 || marker > 0xef) return false
  const sign = JPEG_KEPT_APPS.get(marker)
  return sign === undefined || ascii(body, 0, sign.length) !== sign
}

function jpegWithoutMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]
  let at = 2
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0
    if (marker === JPEG_SCAN) break
    const end = Math.min(bytes.length, at + 2 + be16(bytes, at + 2))
    if (!isJpegMetadata(marker, bytes.subarray(at + 4, end))) kept.push(bytes.subarray(at, end))
    at = end
  }
  kept.push(bytes.subarray(at))
  return joined(kept)
}

export function withoutMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (isWebp(bytes)) return webpWithoutMetadata(bytes)
  if (isJpeg(bytes)) return jpegWithoutMetadata(bytes)
  return bytes.slice()
}

export function carriesMetadata(bytes: Uint8Array): boolean {
  if (isWebp(bytes)) {
    for (let at = 12; at + 8 <= bytes.length;) {
      if (WEBP_METADATA.includes(ascii(bytes, at, 4))) return true
      const size = le32(bytes, at + 4)
      at += 8 + size + (size % 2)
    }
    return false
  }

  if (isJpeg(bytes)) {
    for (let at = 2; at + 4 <= bytes.length && bytes[at] === 0xff;) {
      const marker = bytes[at + 1] ?? 0
      if (marker === JPEG_SCAN) return false
      if (marker === 0xe1) return true
      at += 2 + be16(bytes, at + 2)
    }
    return false
  }

  return true
}
