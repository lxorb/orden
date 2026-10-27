/** A page's picture made pixels: an SVG rasterised by the browser, at twice its size.
 *  Its own module because nothing but a browser can do it, so a test stands in for it
 *  here and nowhere else. Used for the PNG export and for what a page note's PDF cannot
 *  set as text; see out.ts. */

/** One SVG rasterised by the browser, which is how the canvas's PNG is made too.
 *  Null where the browser refused the picture, which is a page nothing could be
 *  drawn from rather than an error worth a dialog. */
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

let measuring: CanvasRenderingContext2D | null | undefined

/** How wide the browser sets a run of text at a size in a face: what a pictured card's
 *  lines are broken by, so they fit the card in the picture the browser then draws in
 *  the same face. Zero where there is no 2d context, which breaks nothing. */
export function textWidth(text: string, size: number, face: string): number {
  measuring ??= document.createElement('canvas').getContext('2d')
  if (!measuring) return 0

  measuring.font = `400 ${size}px ${face}`
  return measuring.measureText(text).width
}
