export interface Part {
  rows?: number
  width: number
  height: number
}

export async function pixelsOf(src: string, part: Part): Promise<Uint8ClampedArray | null> {
  const picture = new Image()
  picture.crossOrigin = 'anonymous'
  picture.decoding = 'async'
  picture.src = src

  try {
    await picture.decode()
  } catch {
    return null
  }

  const width = picture.naturalWidth
  const height = picture.naturalHeight
  if (!width || !height) return null

  const canvas = document.createElement('canvas')
  canvas.width = part.width
  canvas.height = part.height
  const paint = canvas.getContext('2d', { willReadFrequently: true })
  if (!paint) return null

  const rows = Math.min(height, part.rows ?? height)
  paint.drawImage(picture, 0, 0, width, rows, 0, 0, part.width, part.height)
  try {
    return paint.getImageData(0, 0, part.width, part.height).data
  } catch {
    return null
  }
}
