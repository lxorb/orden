import type { PaperAt } from './paper'

export async function svgToPng(
  svg: string,
  width: number,
  height: number,
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

    const paper = document.createElement('canvas')
    paper.width = Math.max(1, Math.round(width * 2))
    paper.height = Math.max(1, Math.round(height * 2))

    const ctx = paper.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(image, 0, 0, paper.width, paper.height)
    const blob = await new Promise<Blob | null>((resolve) => paper.toBlob(resolve, 'image/png'))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function paperPicture(at: PaperAt, number: number): Promise<string | null> {
  const { paperOf } = await import('./paper')
  let paper = await paperOf(at, number)
  if (paper && !paper.image.width) paper = await paperOf(at, number)
  if (!paper?.image.width) return null

  const sheet = document.createElement('canvas')
  sheet.width = paper.image.width
  sheet.height = paper.image.height

  const ctx = sheet.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(paper.image, 0, 0)
  return sheet.toDataURL('image/png')
}

export async function paperIsLocked(at: PaperAt): Promise<boolean> {
  const { paperIsLocked: asked } = await import('./paper')
  return asked(at)
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
