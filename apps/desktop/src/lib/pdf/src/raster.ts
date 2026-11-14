import { pngData, pngDrawn } from '../../png-off'
import { type PaperAt, paperOf, sharpness } from './paper'

export async function svgToPng(
  svg: string,
  width: number,
  height: number,
  paper: (() => Promise<ImageBitmap | null>) | null = null,
): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))

  try {
    const image = new Image()
    image.decoding = 'sync'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('that page could not be drawn'))
      image.src = url
    })

    const sharp = sharpness(width, height, 2)
    const wide = Math.max(1, Math.round(width * sharp))
    const high = Math.max(1, Math.round(height * sharp))
    return await pngDrawn(wide, high, async () => {
      const under = paper ? await paper() : null
      return (drawing) => {
        if (paper) {
          drawing.fillStyle = '#ffffff'
          drawing.fillRect(0, 0, wide, high)
        }
        if (under) drawing.drawImage(under, 0, 0, wide, high)
        drawing.drawImage(image, 0, 0, wide, high)
      }
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function paperUnder(at: PaperAt, number: number): Promise<ImageBitmap | null> {
  let paper = await paperOf(at, number)
  if (paper && !paper.image.width) paper = await paperOf(at, number)
  return paper?.image.width ? paper.image : null
}

export async function paperPicture(at: PaperAt, number: number): Promise<string | null> {
  const image = await paperUnder(at, number)
  if (!image) return null

  const sheet = document.createElement('canvas')
  sheet.width = image.width
  sheet.height = image.height

  const ctx = sheet.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(image, 0, 0)
  return pngData(sheet)
}

let measuring: CanvasRenderingContext2D | null | undefined

function context(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  measuring ??= document.createElement('canvas').getContext('2d')
  return measuring
}

export function cssColour(colour: string): string {
  const ctx = context()
  if (!ctx) return colour

  ctx.fillStyle = '#000000'
  ctx.fillStyle = colour
  return ctx.fillStyle
}
