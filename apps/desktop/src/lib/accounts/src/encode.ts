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
  const [s, l] = await Promise.all([SMALL, LARGE].map((size) => encodedSmall(drawn(picture, square, size))))
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
    if (!bytes) throw new Error('no picture')
    if (bytes.byteLength > MOST_BYTES) continue
    return {
      bytes: bytes.slice().buffer,
      type: kept.type === 'image/webp' ? 'image/webp' : 'image/jpeg',
    }
  }
  throw new Error('that picture is too big')
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((done) => {
    canvas.toBlob(done, type, quality)
  })
}

const WEBP_METADATA = new Set(['EXIF', 'XMP '])
const VP8X_METADATA = 0x0c
const JPEG_METADATA = 0xe1

function joined(head: Uint8Array, parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, one) => sum + one.length, head.length))
  out.set(head)
  let at = head.length
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export function withoutMetadata(bytes: Uint8Array): Uint8Array | null {
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length))

  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kept: Uint8Array[] = []
    for (let at = 12; at + 8 <= bytes.length;) {
      const name = ascii(at, 4)
      const size = new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4).getUint32(0, true)
      const end = Math.min(bytes.length, at + 8 + size + (size % 2))
      if (!WEBP_METADATA.has(name)) {
        const chunk = bytes.slice(at, end)
        if (name === 'VP8X') chunk[8] = (chunk[8] ?? 0) & ~VP8X_METADATA
        kept.push(chunk)
      }
      at = end
    }
    const out = joined(bytes.subarray(0, 12), kept)
    new DataView(out.buffer).setUint32(4, out.length - 8, true)
    return out
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const kept: Uint8Array[] = []
    let at = 2
    while (at + 4 <= bytes.length && bytes[at] === 0xff && bytes[at + 1] !== 0xda) {
      const end = at + 2 + (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0))
      if (bytes[at + 1] !== JPEG_METADATA) kept.push(bytes.subarray(at, end))
      at = end
    }
    kept.push(bytes.subarray(at))
    return joined(bytes.subarray(0, 2), kept)
  }

  return null
}
