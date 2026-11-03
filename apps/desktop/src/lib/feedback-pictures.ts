/** The pictures a report carries (#1087): pasted, dropped or picked in the Send feedback
 *  sheet, shown there small, and sent with the words.
 *
 *  Each is drawn afresh before it goes, which is what takes off everything a camera or
 *  an editor wrote beside the picture - EXIF with the place it was taken, XMP, comments
 *  - since a canvas writes none of it; the service takes it off again for anything that
 *  did not come through here (services/sync/src/feedback-images.ts). Drawn no longer
 *  than `LONGEST_EDGE` on either side, as a PNG where the picture was one without loss,
 *  a screenshot's usual kind, and as a JPEG otherwise, and made smaller until it fits
 *  under the service's `MOST_PICTURE_BYTES`. */

/** As many as the service takes with one report, and as large; see feedback-images.ts. */
export const MOST_PICTURES = 4
export const MOST_PICTURE_BYTES = 1_000_000

/** The longest side a picture is drawn at: a screenshot of a large screen still reads. */
export const LONGEST_EDGE = 2400

export type PictureType = 'image/png' | 'image/jpeg'

/** A picture ready to go: its bytes as the data URL the service takes, and an address to
 *  show it by in the sheet. */
export interface Picture {
  id: string
  dataUrl: string
  preview: string
}

/** What draws a picture and writes it out: the window's canvas in the app, and a fake
 *  in the tests. */
export interface Drawing {
  /** The picture's size, or null where it is not one the window can draw. */
  open(file: Blob): Promise<{ width: number; height: number } | null>
  /** The picture drawn at this size and written as `type`. */
  write(width: number, height: number, type: PictureType, quality: number): Promise<Blob>
  close(): void
}

/** The size a picture is drawn at: no longer than `edge` on either side, never larger
 *  than it is, and at least a pixel. */
export function fitWithin(
  width: number,
  height: number,
  edge: number,
): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height, 1))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** The kind a picture is written as: a PNG where the one given was without loss. */
export function writtenAs(type: string): PictureType {
  return type === 'image/jpeg' || type === 'image/heic' || type === 'image/heif'
    ? 'image/jpeg'
    : 'image/png'
}

/** The files among what was pasted, dropped or picked that say they are pictures. */
export function picturesAmong(files: Iterable<File>): File[] {
  return [...files].filter((file) => file.type.startsWith('image/'))
}

/** The tries a picture is written in, from the first to the last: as it came at its
 *  size, then as a JPEG, smaller each time. */
function tries(type: PictureType): { edge: number; type: PictureType; quality: number }[] {
  return [
    { edge: LONGEST_EDGE, type, quality: 0.88 },
    { edge: LONGEST_EDGE, type: 'image/jpeg', quality: 0.82 },
    { edge: 1800, type: 'image/jpeg', quality: 0.8 },
    { edge: 1400, type: 'image/jpeg', quality: 0.78 },
    { edge: 1000, type: 'image/jpeg', quality: 0.75 },
  ]
}

/** One picture drawn afresh and fitted under the service's limit, as bytes and their
 *  kind; null where the window cannot draw it, or it will not fit however small. */
export async function redrawn(
  file: Blob,
  drawing: Drawing,
): Promise<{ blob: Blob; type: PictureType } | null> {
  const size = await drawing.open(file).catch(() => null)
  if (!size) return null
  try {
    for (const one of tries(writtenAs(file.type))) {
      const fitted = fitWithin(size.width, size.height, one.edge)
      const blob = await drawing.write(fitted.width, fitted.height, one.type, one.quality)
      if (blob.size <= MOST_PICTURE_BYTES) return { blob, type: one.type }
    }
    return null
  } finally {
    drawing.close()
  }
}

/** The window's own canvas, as `Drawing`. The picture is turned the way its camera said
 *  before it is drawn, since the line that said so goes with the rest. */
function canvasDrawing(): Drawing {
  let bitmap: ImageBitmap | null = null
  return {
    async open(file) {
      if (typeof createImageBitmap !== 'function') return null
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { width: bitmap.width, height: bitmap.height }
    },
    async write(width, height, type, quality) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context || !bitmap) throw new Error('nothing to draw with')
      // A JPEG has no transparency: what was see-through is white, not black.
      if (type === 'image/jpeg') {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, width, height)
      }
      context.drawImage(bitmap, 0, 0, width, height)
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('not written'))),
          type,
          quality,
        )
      })
    },
    close() {
      bitmap?.close()
      bitmap = null
    },
  }
}

/** A blob as the data URL the service takes. */
export async function dataUrlOf(blob: Blob, type: PictureType): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return `data:${type};base64,${btoa(binary)}`
}

let made = 0

/** One file made ready to go with a report, or null where it cannot be. */
export async function pictureOf(file: Blob, drawing = canvasDrawing()): Promise<Picture | null> {
  const drawn = await redrawn(file, drawing)
  if (!drawn) return null
  const dataUrl = await dataUrlOf(drawn.blob, drawn.type)
  made++
  return { id: `picture-${String(made)}`, dataUrl, preview: dataUrl }
}
