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

/** One 2d context to measure and read colours with, or null where there is none. */
function context(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  measuring ??= document.createElement('canvas').getContext('2d')
  return measuring
}

/** A CSS colour as the browser says it back, which is hex or `rgb()` whatever form it
 *  was written in - `hsl()`, a name, a theme's `rgb(...)` - so the PDF, which wants
 *  numbers, can read it. Unchanged where there is no 2d context. */
export function cssColour(colour: string): string {
  const ctx = context()
  if (!ctx) return colour

  ctx.fillStyle = '#000000'
  ctx.fillStyle = colour
  return ctx.fillStyle
}
