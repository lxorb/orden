export const MOST_PICTURES = 4
export const MOST_PICTURE_BYTES = 1_000_000

export const LONGEST_EDGE = 2400

export type PictureType = 'image/png' | 'image/jpeg'

export interface Picture {
  id: string
  dataUrl: string
  preview: string
}

export interface Drawing {
  open(file: Blob): Promise<{ width: number; height: number } | null>
  write(width: number, height: number, type: PictureType, quality: number): Promise<Blob>
  close(): void
}

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

export function writtenAs(type: string): PictureType {
  return type === 'image/jpeg' || type === 'image/heic' || type === 'image/heif'
    ? 'image/jpeg'
    : 'image/png'
}

export function picturesAmong(files: Iterable<File>): File[] {
  return [...files].filter((file) => file.type.startsWith('image/'))
}

function tries(type: PictureType): { edge: number; type: PictureType; quality: number }[] {
  return [
    { edge: LONGEST_EDGE, type, quality: 0.88 },
    { edge: LONGEST_EDGE, type: 'image/jpeg', quality: 0.82 },
    { edge: 1800, type: 'image/jpeg', quality: 0.8 },
    { edge: 1400, type: 'image/jpeg', quality: 0.78 },
    { edge: 1000, type: 'image/jpeg', quality: 0.75 },
  ]
}

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

export async function dataUrlOf(blob: Blob, type: PictureType): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return `data:${type};base64,${btoa(binary)}`
}

let made = 0

export async function pictureOf(file: Blob, drawing = canvasDrawing()): Promise<Picture | null> {
  const drawn = await redrawn(file, drawing)
  if (!drawn) return null
  const dataUrl = await dataUrlOf(drawn.blob, drawn.type)
  made++
  return { id: `picture-${String(made)}`, dataUrl, preview: dataUrl }
}
