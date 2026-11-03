/** The pictures a report sent with Send feedback carries (#1087): a screenshot is most
 *  of what a report about something drawn wrong can say.
 *
 *  They arrive in the report's own body as data URLs, at most `MOST_IMAGES` of them and
 *  `MOST_IMAGE_BYTES` each, as PNG or JPEG - the app turns whatever was pasted, dropped
 *  or picked into one of the two before it sends. Each is read for what it is rather
 *  than what it says it is, and what a camera or an editor wrote into it beside the
 *  picture goes before it is kept: EXIF, with the place it was taken, XMP, comments and
 *  text chunks. The app has already drawn each picture afresh, which writes none of
 *  that; this is for whatever else posts here.
 *
 *  Kept in the notes bucket under `feedback/<report>/<name>`, and served at
 *  `/v1/feedback/images/<name>` to whoever holds the name: 32 random bytes, written
 *  only into the report's issue, which GitHub fetches it for, and onto its page. */

export const MOST_IMAGES = 4
const MOST_IMAGE_BYTES = 1_000_000

/** How long one data URL may be: the picture in base64, and its prefix. */
export const MOST_DATA_URL = Math.ceil(MOST_IMAGE_BYTES / 3) * 4 + 64

export type PictureType = 'image/png' | 'image/jpeg'

export interface Picture {
  type: PictureType
  bytes: Uint8Array
}

/** Where a picture's bytes are kept in the bucket. */
export function pictureKey(report: string, name: string): string {
  return `feedback/${report}/${name}`
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** What the bytes are, read off their first few. */
export function sniffed(bytes: Uint8Array): PictureType | null {
  if (PNG_SIGNATURE.every((byte, at) => bytes[at] === byte)) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

/** One picture out of a data URL, without what was written beside it; or the sentence
 *  that says why not. */
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

/** The chunks of a PNG that are words about the picture rather than the picture: EXIF,
 *  text of any kind, and when it was made. */
const PNG_WORDS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])

/** A PNG without its words, or null where it is not one that can be walked to its end. */
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

/** Whether a JPEG segment is kept: the JFIF header, the colour profile and Adobe's
 *  colour marker, which say how to draw it. Every other application segment - EXIF and
 *  XMP in APP1, a camera maker's, Photoshop's - and every comment goes. */
function keptSegment(marker: number): boolean {
  if (marker === 0xfe) return false
  if (marker < 0xe0 || marker > 0xef) return true
  return marker === 0xe0 || marker === 0xe2 || marker === 0xee
}

/** A JPEG without what was written beside the picture, or null where it is not one that
 *  can be walked to its scan. */
export function jpegWithout(bytes: Uint8Array): Uint8Array | null {
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1] ?? 0
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at++
      continue
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)
    if (length < 2) return null
    const end = at + 2 + length
    if (end > bytes.length) return null
    // The scan, and everything after it, is the picture itself.
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
