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
    const bytes = await kept.arrayBuffer()
    if (bytes.byteLength > MOST_BYTES) continue
    if (carriesMetadata(new Uint8Array(bytes))) throw new Error('a picture kept its metadata')
    return { bytes, type: kept.type === 'image/webp' ? 'image/webp' : 'image/jpeg' }
  }
  throw new Error('that picture is too big')
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((done) => {
    canvas.toBlob(done, type, quality)
  })
}

export function carriesMetadata(bytes: Uint8Array): boolean {
  const ascii = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length))

  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    for (let at = 12; at + 8 <= bytes.length;) {
      const name = ascii(at, 4)
      if (name === 'EXIF' || name === 'XMP ') return true
      const size =
        (bytes[at + 4] ?? 0) |
        ((bytes[at + 5] ?? 0) << 8) |
        ((bytes[at + 6] ?? 0) << 16) |
        ((bytes[at + 7] ?? 0) << 24)
      at += 8 + size + (size % 2)
    }
    return false
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at + 4 <= bytes.length && bytes[at] === 0xff;) {
      const marker = bytes[at + 1] ?? 0
      if (marker === 0xda) return false
      if (marker === 0xe1) return true
      at += 2 + (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0))
    }
    return false
  }

  return true
}
