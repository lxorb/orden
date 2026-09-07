/** A page drawn to pixels.
 *
 *  The one file here that needs a browser. Everything it does, it does on a
 *  canvas the reader never sees: it measures the app's own faces so the layout
 *  breaks lines where the panel will break them, it draws a page white on black
 *  because the glasses light pixels rather than ink them, and it reads the
 *  result back as one level per pixel.
 *
 *  Formulae and pictures are prepared before a page is laid out, not while it is
 *  drawn: both take a round trip through the browser's image decoder, and a
 *  line cannot be broken until its formula's width is known. See `prepare`. */

import katex from 'katex'
import type { Block } from './blocks'
import { ditherToLevels, quantise, type Tile } from './encode'
import { fontOf, fontsReady } from './fonts'
import type { Line, Page, Placed } from './layout'
import { type Box, edgeOf, type MathBox, type Measurer, type Painted } from './measure'
import { BLACK, MARGIN_TOP, MARGIN_X, PANEL_HEIGHT, PANEL_WIDTH, WHITE } from './panel'
import type { MathRun, Run } from './runs'
import type { Family, TextStyle } from './style'

export interface PainterOptions {
  /** KaTeX's stylesheet with its faces inside it as `data:` URIs. A formula is
   *  drawn by handing the browser a picture of itself, and a picture carries no
   *  stylesheet of its own, so without this a formula falls back to its own
   *  source in the mono face. The app has this already; see math-fonts.ts. */
  mathStyles?: (html: string) => string
  /** A picture's address as the note wrote it, turned into one this page can
   *  load. Without it only addresses that already resolve are drawn. */
  resolvePicture?: (source: string) => string
}

/** A formula or a picture, ready to draw. */
interface Ready {
  box: MathBox
  /** Null when the drawing could not be had and the words stand in for it. */
  picture: CanvasImageSource | null
}

/** What a note needs prepared before it can be laid out. */
export interface Drawn {
  math: MathRun[]
  pictures: string[]
}

/** Every formula and picture in a note, once each. */
export function drawnIn(blocks: readonly Block[]): Drawn {
  const math = new Map<string, MathRun>()
  const pictures = new Set<string>()

  const fromRun = (run: Run) => {
    if (run.math) math.set(`${run.math.display ? 'd' : 'i'}${run.math.tex}`, run.math)
    if (run.picture) pictures.add(run.picture.source)
  }

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
      case 'text':
        block.runs.forEach(fromRun)
        break
      case 'item':
        block.runs.forEach(fromRun)
        break
      case 'math':
        math.set(`d${block.tex}`, { tex: block.tex, display: true })
        break
      case 'picture':
        pictures.add(block.source)
        break
      case 'table':
        for (const row of [block.head, ...block.rows]) for (const cell of row) cell.forEach(fromRun)
        break
      case 'code':
      case 'rule':
        // Neither holds anything that has to be drawn first.
        break
    }
  }

  return { math: [...math.values()], pictures: [...pictures] }
}

/** A canvas to draw on, offscreen where the browser has one. */
function surfaceOf(
  width: number,
  height: number,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
  }
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.getContext('2d', { willReadFrequently: true })
}

/** A grey as the canvas wants it. Multiples of seventeen, so a level read back
 *  out of the pixels is the level that went in. */
function greyCss(level: number): string {
  const value = Math.min(255, Math.max(0, Math.round((level / WHITE) * 255)))
  return `rgb(${value},${value},${value})`
}

function styleKey(style: TextStyle): string {
  return `${style.family}|${style.size}|${style.weight}|${style.slant}`
}

/** The four containers the panel is covered with, in the order they are sent.
 *
 *  An image container may be at most 288 wide and 144 tall, so the whole panel
 *  takes four of them, which is also the most the glasses will hold. Left to
 *  right, top to bottom. */
export const QUADRANTS: readonly { x: number; y: number; width: number; height: number }[] = [
  { x: 0, y: 0, width: PANEL_WIDTH / 2, height: PANEL_HEIGHT / 2 },
  { x: PANEL_WIDTH / 2, y: 0, width: PANEL_WIDTH / 2, height: PANEL_HEIGHT / 2 },
  { x: 0, y: PANEL_HEIGHT / 2, width: PANEL_WIDTH / 2, height: PANEL_HEIGHT / 2 },
  { x: PANEL_WIDTH / 2, y: PANEL_HEIGHT / 2, width: PANEL_WIDTH / 2, height: PANEL_HEIGHT / 2 },
]

export class Painter implements Measurer {
  private readonly ruler: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  private readonly panel: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  private readonly fonts = new Map<string, string>()
  private readonly reaches = new Map<string, { ascent: number; descent: number }>()
  private readonly formulae = new Map<string, Ready>()
  private readonly images = new Map<string, Ready>()

  private constructor(
    ruler: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    panel: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    private readonly options: PainterOptions,
  ) {
    this.ruler = ruler
    this.panel = panel
  }

  /** A painter, or null where there is no canvas to be had - a worker without
   *  `OffscreenCanvas`, a test in node. The caller falls back to the ruler in
   *  measure.ts, which is what the page count is worked out from until then. */
  static create(options: PainterOptions = {}): Painter | null {
    const ruler = surfaceOf(8, 8)
    const panel = surfaceOf(PANEL_WIDTH, PANEL_HEIGHT)
    return ruler && panel ? new Painter(ruler, panel, options) : null
  }

  private fontFor(style: TextStyle): string {
    const key = styleKey(style)
    let font = this.fonts.get(key)
    if (font === undefined) {
      font = fontOf(style.family, style.size, style.weight, style.slant)
      this.fonts.set(key, font)
    }

    return font
  }

  width(text: string, style: TextStyle): number {
    if (!text) return 0

    this.ruler.font = this.fontFor(style)
    return this.ruler.measureText(text).width
  }

  private reachOf(style: TextStyle): { ascent: number; descent: number } {
    const key = styleKey(style)
    let found = this.reaches.get(key)
    if (!found) {
      this.ruler.font = this.fontFor(style)
      // `M` rather than the text itself: a line's height must not depend on
      // whether the words in it happen to have a descender.
      const metrics = this.ruler.measureText('Mg')
      found = {
        ascent: metrics.fontBoundingBoxAscent || style.size * 0.8,
        descent: metrics.fontBoundingBoxDescent || style.size * 0.2,
      }
      this.reaches.set(key, found)
    }

    return found
  }

  ascent(style: TextStyle): number {
    return this.reachOf(style).ascent
  }

  descent(style: TextStyle): number {
    return this.reachOf(style).descent
  }

  math(tex: string, display: boolean): MathBox {
    const ready = this.formulae.get(`${display ? 'd' : 'i'}${tex}`)
    if (ready) return ready.box

    // Not prepared: the source stands in for it, and takes the room the source
    // takes, so the line breaks where it will actually break.
    return {
      width: this.width(tex, MATH_FALLBACK),
      height: Math.round(MATH_FALLBACK.size * 1.2),
      depth: display ? 0 : Math.round(MATH_FALLBACK.size * 0.2),
    }
  }

  picture(source: string, most: Box): Box | null {
    const ready = this.images.get(source)
    if (!ready) return null

    return fit(ready.box, most)
  }

  /** Everything that has to arrive before a note can be laid out: the faces, and
   *  a drawing of every formula and picture in it. */
  async prepare(drawn: Drawn, families: Iterable<Family>): Promise<void> {
    await fontsReady(families)
    await Promise.all([
      ...drawn.math.map((one) => this.prepareMath(one)),
      ...drawn.pictures.map((source) => this.preparePicture(source)),
    ])
  }

  private async prepareMath(one: MathRun): Promise<void> {
    const key = `${one.display ? 'd' : 'i'}${one.tex}`
    if (this.formulae.has(key)) return

    const html = katex.renderToString(one.tex, {
      displayMode: one.display,
      throwOnError: false,
      output: 'html',
      trust: false,
      strict: false,
    })

    const size = one.display ? 19 : 15
    // A `$$` block has a line to itself and sits on it, so none of it is below
    // the baseline. The measurement would say otherwise - an inline block's
    // baseline is the baseline of the last line inside it, which for a formula
    // is somewhere in the middle of it - and the words underneath would then be
    // written over.
    const measured = measureHtml(html, size, SLACK)
    const box = measured && one.display ? { ...measured, depth: 0 } : measured
    const fallback: Ready = {
      box: box ?? this.math(one.tex, one.display),
      picture: null,
    }

    const styles = this.options.mathStyles?.(html)
    if (!box || !styles) {
      this.formulae.set(key, fallback)
      return
    }

    const picture = await pictureOfHtml(html, styles, box, size)
    this.formulae.set(key, picture ? { box, picture } : fallback)
  }

  private async preparePicture(source: string): Promise<void> {
    if (this.images.has(source) || typeof Image === 'undefined') return

    const href = this.options.resolvePicture?.(source) ?? source
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = href

    // A picture the page cannot load is left out of the map, and the layout
    // sets its description instead; see the `picture` block in layout.ts.
    const loaded = await image
      .decode()
      .then(() => true)
      .catch(() => false)
    if (!loaded || !image.naturalWidth) return

    this.images.set(source, {
      box: { width: image.naturalWidth, height: image.naturalHeight, depth: 0 },
      picture: image,
    })
  }

  /** A page as one level per pixel, the whole panel. `mark` goes in the band
   *  along the bottom: the page count, and nothing else ever. */
  draw(page: Page, mark = ''): Tile {
    const ctx = this.panel
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = greyCss(BLACK)
    ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT)
    ctx.textBaseline = 'alphabetic'

    page.lines.forEach((line, at) => {
      this.drawLine(line, MARGIN_TOP + (page.tops[at] ?? 0))
    })

    if (mark) {
      ctx.font = this.fontFor(MARK_STYLE)
      ctx.fillStyle = greyCss(MARK_STYLE.grey)
      ctx.fillText(mark, PANEL_WIDTH - MARGIN_X - this.width(mark, MARK_STYLE), PANEL_HEIGHT - 4)
    }

    return this.read()
  }

  private drawLine(line: Line, top: number): void {
    const ctx = this.panel

    for (const fill of line.fills) {
      ctx.fillStyle = greyCss(fill.grey)
      ctx.fillRect(MARGIN_X + fill.x, top + fill.y, fill.width, fill.height)
    }

    const baseline = top + line.baseline
    // Boxes behind everything, so a mark under two runs is one mark.
    for (const one of line.placed) {
      if (one.run.box === undefined) continue

      ctx.fillStyle = greyCss(one.run.box)
      ctx.fillRect(
        MARGIN_X + one.x - 1,
        baseline - this.ascent(one.run.style),
        one.width + 2,
        this.ascent(one.run.style) + this.descent(one.run.style),
      )
    }

    for (const one of line.placed) this.drawRun(one, baseline, top, line.height)
  }

  private drawRun(one: Placed, baseline: number, top: number, height: number): void {
    const ctx = this.panel
    const { run } = one
    const x = MARGIN_X + one.x

    if (run.math) {
      const ready = this.formulae.get(`${run.math.display ? 'd' : 'i'}${run.math.tex}`)
      if (ready?.picture) {
        // Drawn into the width the layout placed it in, which may be less than
        // it measured: a formula wider than the column is set smaller rather
        // than run off the edge. See `centred` in layout.ts.
        const scale = ready.box.width > 0 ? one.width / ready.box.width : 1
        const height = ready.box.height * scale
        ctx.drawImage(
          ready.picture,
          x,
          baseline - (height - ready.box.depth * scale),
          one.width,
          height,
        )
        return
      }
    }

    if (run.picture) {
      const ready = this.images.get(run.picture.source)
      if (ready?.picture) {
        this.drawPicture(ready, x, top, one.width, height)
        return
      }
    }

    if (!run.text) return

    ctx.font = this.fontFor(run.style)
    ctx.fillStyle = greyCss(run.style.grey)
    const y = baseline - (run.rise ?? 0)
    // A ligature glyph is centred over the room its characters took, the way the
    // editor paints it over them.
    const width = run.over === undefined ? one.width : this.width(run.text, run.style)
    ctx.fillText(run.text, run.over === undefined ? x : x + (one.width - width) / 2, y)

    if (run.style.underline) {
      ctx.fillRect(x, y + Math.max(1, Math.round(run.style.size * 0.09)), one.width, 1)
    }
    if (run.style.strike) {
      ctx.fillRect(x, y - Math.round(run.style.size * 0.28), one.width, 1)
    }
  }

  /** A picture, quantised with an ordered dither so a photograph reads as tones
   *  rather than as five bands. Text is never dithered; see encode.ts. */
  private drawPicture(ready: Ready, x: number, top: number, width: number, height: number): void {
    const ctx = this.panel
    if (!ready.picture) return

    const box = fit(ready.box, { width, height })
    const scratch = surfaceOf(
      Math.max(1, Math.round(box.width)),
      Math.max(1, Math.round(box.height)),
    )
    if (!scratch) return

    scratch.drawImage(ready.picture, 0, 0, box.width, box.height)
    const pixels = scratch.getImageData(0, 0, Math.round(box.width), Math.round(box.height))
    const grey = new Uint8Array(pixels.width * pixels.height)
    for (let at = 0; at < grey.length; at++) {
      const red = pixels.data[at * 4] ?? 0
      const green = pixels.data[at * 4 + 1] ?? 0
      const blue = pixels.data[at * 4 + 2] ?? 0
      const alpha = (pixels.data[at * 4 + 3] ?? 0) / 255
      grey[at] = Math.round((0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha)
    }

    const levels = ditherToLevels(grey, pixels.width, pixels.height)
    for (let at = 0; at < levels.length; at++) {
      const value = Math.round(((levels[at] ?? 0) / WHITE) * 255)
      pixels.data[at * 4] = value
      pixels.data[at * 4 + 1] = value
      pixels.data[at * 4 + 2] = value
      pixels.data[at * 4 + 3] = 255
    }
    scratch.putImageData(pixels, 0, 0)
    ctx.drawImage(scratch.canvas, x, top, pixels.width, pixels.height)
  }

  /** One quadrant of the page last drawn, as the bytes of a PNG file.
   *
   *  PNG rather than the four-bit buffer `encode.ts` can pack, because that is
   *  the format the host documents and the official templates send: it decodes,
   *  scales and converts to four bits itself, and its conversion is said to be
   *  better than one done here. The raw path is kept for the day the nibble
   *  order is published; see docs/even.md.
   *
   *  Taken from the canvas rather than from the quantised levels on purpose: the
   *  host gets the full-depth pixels and does its own reduction, so a glyph's
   *  edge is reduced once instead of twice. */
  async png(at: number): Promise<Uint8Array | null> {
    const quadrant = QUADRANTS[at]
    if (!quadrant) return null

    const scratch = surfaceOf(quadrant.width, quadrant.height)
    if (!scratch) return null

    scratch.drawImage(
      this.panel.canvas,
      quadrant.x,
      quadrant.y,
      quadrant.width,
      quadrant.height,
      0,
      0,
      quadrant.width,
      quadrant.height,
    )

    return bytesOfPng(scratch.canvas)
  }

  /** The panel read back as one level per pixel. */
  private read(): Tile {
    const pixels = this.panel.getImageData(0, 0, PANEL_WIDTH, PANEL_HEIGHT)
    const levels = new Uint8Array(PANEL_WIDTH * PANEL_HEIGHT)
    for (let at = 0; at < levels.length; at++) {
      levels[at] = quantise(pixels.data[at * 4] ?? 0)
    }

    return { width: PANEL_WIDTH, height: PANEL_HEIGHT, levels }
  }
}

/** What a display formula's own block is turned into, so that it takes the room
 *  its formula takes rather than the room the page has. Named once because it is
 *  applied twice: to the copy that is measured and to the picture that is drawn,
 *  which have to agree to the pixel. */
const DISPLAY = { margin: '0', display: 'inline-block', textAlign: 'left' } as const

/** Room left around a formula's picture, in pixels. The edge of a glyph is
 *  antialiased, and the picture clips whatever falls outside it. */
const SLACK = 6

/** One element as the edge walk sees it, straight off the page. The rule about
 *  what counts lives in `edgeOf`; this only mirrors the tree. */
function paintedOf(element: Element): Painted {
  const box = element.getBoundingClientRect()
  const style = getComputedStyle(element)

  return {
    right: box.right,
    bottom: box.bottom,
    clips: style.overflowX !== 'visible' || style.overflowY !== 'visible',
    children: [...element.children].map(paintedOf),
  }
}

/** The page count in the bottom band. Dim on purpose: it is not the note. */
const MARK_STYLE: TextStyle = {
  family: 'ui',
  size: 10,
  weight: 'normal',
  slant: 'normal',
  grey: 6,
  underline: false,
  strike: false,
}

/** The mono face a formula falls back to, and the size it is measured at. */
const MATH_FALLBACK: TextStyle = {
  family: 'mono',
  size: 14,
  weight: 'normal',
  slant: 'normal',
  grey: WHITE,
  underline: false,
  strike: false,
}

/** A box scaled to fit inside another, never enlarged. */
function fit(box: Box, most: Box): Box {
  const scale = Math.min(1, most.width / box.width, most.height / box.height)
  return { width: Math.floor(box.width * scale), height: Math.floor(box.height * scale) }
}

/** How big a piece of KaTeX's HTML comes out, and how much of it hangs below the
 *  baseline, measured on the page itself, which is the only thing that knows the
 *  stylesheet.
 *
 *  The depth is read off a marker of no size at all set after the formula: an
 *  empty inline block sits exactly on its line's baseline, so the distance from
 *  its top to the bottom of the formula is the formula's depth. Without it an
 *  inline fraction floats a third of a line above the words beside it. */
function measureHtml(html: string, size: number, slack: number): MathBox | null {
  if (typeof document === 'undefined') return null

  const host = document.createElement('div')
  // `max-content` is what makes a display formula measure its own width: the
  // block KaTeX wraps one in is as wide as whatever holds it, and a page-wide
  // answer would have every formula scaled to nothing.
  host.setAttribute(
    'style',
    `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;` +
      `width:max-content;font-size:${size}px;line-height:1.2`,
  )
  const body = document.createElement('span')
  body.innerHTML = html
  const marker = document.createElement('span')
  marker.setAttribute('style', 'display:inline-block;width:0;height:0')
  host.append(body, marker)
  document.body.append(host)

  // A display formula is wrapped in a centred block with margins meant for a
  // page of prose. Both are undone here and again in the picture, by the same
  // three declarations, so that what is measured is what is drawn.
  const display = body.querySelector('.katex-display')
  if (display instanceof HTMLElement) {
    display.style.margin = DISPLAY.margin
    display.style.display = DISPLAY.display
    display.style.textAlign = DISPLAY.textAlign
  }

  // The host, not the formula inside it: the picture is laid out the same way
  // from the same top-left corner, so measuring the box the whole thing takes is
  // what makes the two agree. A span's own rectangle would not do - for an
  // inline element it is the line boxes its content sits on rather than the
  // boxes inside it, which for a two-storey fraction is far too short.
  const box = host.getBoundingClientRect()
  // The marker answers both questions, and answers them exactly. Its top is the
  // line's baseline, because an empty inline block sits on one. Its left is
  // where the formula ends, because that is what inline layout means by ending -
  // which the box around the formula does not always agree with: KaTeX draws a
  // big delimiter with negative margins, and a box shrunk to fit around one
  // comes out narrower than what it holds, so the last symbol of a `$$` block
  // falls outside the picture and is simply gone.
  const end = marker.getBoundingClientRect()
  // And the far edge of everything inside it that can actually show, which is
  // neither the outermost box nor every box there is; see `edgeOf`.
  const { right, bottom } = edgeOf([...host.children].map(paintedOf), {
    right: end.left,
    bottom: box.bottom,
  })

  const width = Math.max(host.scrollWidth, Math.ceil(right - box.left))
  const height = Math.max(host.scrollHeight, Math.ceil(bottom - box.top))
  const baseline = end.top
  host.remove()

  const wide = Math.max(Math.ceil(box.width), width)
  const out = {
    // The widest answer, and room to spare on top of it.
    //
    // The spare room is not politeness. Every way of asking how wide a formula
    // is - the box, the scroll width, the far edge of everything inside it, the
    // place inline layout says it ends - agrees to within a pixel, and every one
    // of them is still short of what the same markup draws inside a picture,
    // whose viewport then cuts the last symbol off. Rather than keep guessing at
    // why, the picture is simply given a tenth more than the formula
    // measured. A `$$` block is centred, so the spare room moves it half of that
    // to the left of centre, which nobody can see; a `$…$` span carries a few
    // pixels of it as space before the next word.
    //
    // None of this goes downwards: the depth is what puts a formula on the line,
    // and padding underneath would lift it off.
    width: wide + Math.ceil(wide / 10) + slack,
    height: Math.max(Math.ceil(box.height), height),
    depth: Math.max(0, Math.round(box.bottom - baseline)),
  }

  return out.width > slack && out.height > 0 ? out : null
}

/** HTML as a picture the canvas will take.
 *
 *  Through an SVG that carries the HTML in a `foreignObject` and the stylesheet
 *  in a `<style>`. The faces have to be inside the stylesheet as data - a
 *  picture fetches nothing - which is what `mathStyles` is for. White on
 *  nothing, because the glasses light pixels. */
async function pictureOfHtml(
  html: string,
  styles: string,
  box: Box,
  size: number,
): Promise<CanvasImageSource | null> {
  if (typeof Image === 'undefined') return null

  // The picture is exactly the box that was measured, and the display block is
  // undone here the same way it was undone there, so the two agree on where
  // every glyph is.
  const undo =
    `.katex-display{margin:${DISPLAY.margin};display:${DISPLAY.display};` +
    `text-align:${DISPLAY.textAlign}}`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:${size}px;line-height:1.2;color:#fff;white-space:nowrap">` +
    `<style>${styles}${undo}</style>${html}</div>` +
    `</foreignObject></svg>`

  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

  return image
    .decode()
    .then(() => image as CanvasImageSource)
    .catch(() => null)
}

/** A canvas as the bytes of a PNG file. Two ways to ask, because an offscreen
 *  canvas answers with a promise and a page's canvas with a data URI. */
async function bytesOfPng(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array | null> {
  if ('convertToBlob' in canvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  }

  const url = canvas.toDataURL('image/png')
  const base64 = url.slice(url.indexOf(',') + 1)
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) out[at] = binary.charCodeAt(at)

  return out
}

/** The whole panel cut into the four tiles the containers take. */
export function quadrantsOf(panel: Tile): Tile[] {
  return QUADRANTS.map(({ x, y, width, height }) => {
    const levels = new Uint8Array(width * height)
    for (let row = 0; row < height; row++) {
      const from = (y + row) * panel.width + x
      levels.set(panel.levels.subarray(from, from + width), row * width)
    }

    return { width, height, levels }
  })
}
