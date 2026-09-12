/** The paper behind a page, where the paper is a page of a PDF.
 *
 *  A page note made from a PDF keeps the PDF. Nothing is baked into the note: each
 *  page says which file and which page of it, and the picture is drawn from the
 *  paper itself when that page comes near the view. So the PDF in the space is the
 *  one copy of it - Obsidian opens it, a rename is one file to rename, and the note
 *  beside it is kilobytes of ink rather than a folder of PNGs.
 *
 *  Drawn once per page and kept, because a page somebody is writing on is a page
 *  they are looking at for minutes: rasterising it on every scroll would be the one
 *  thing the surface cannot afford. Kept as a bitmap rather than a canvas, which is
 *  what a 2d context can draw without a second copy.
 *
 *  Two caps, and they are different caps. The first is the scale: twice the page's
 *  own size, which is enough for a retina screen and for a reader who zooms in a
 *  little, and past which the pixels are not worth their memory. The second is the
 *  area, because a poster at twice its size is a texture a browser either refuses or
 *  pays for in memory nobody gets back; past it the page is drawn a little softer
 *  rather than not at all, which is what the PDF viewer already does.
 *
 *  How many are kept at once is capped as well. A note made from a four hundred page
 *  scan would otherwise hold four hundred bitmaps the moment somebody scrolled to
 *  the end of it, and the pages nobody is looking at are the ones to let go of. */

import { openDocument } from '../pdf/document'
import { PDF_TO_CSS } from '../pdf/pages'

/** How much bigger than the page itself a background is drawn. */
const SCALE = 2

/** How many pixels one page may be drawn with; the same ceiling one page of the
 *  PDF viewer has, for the same reason. */
const MOST_PIXELS = 16 * 1024 * 1024

/** How many pages' backgrounds are held at once. A screenful is two or three, and
 *  this is enough that scrolling back a page or two finds them already drawn. */
const KEPT = 24

/** A page of a paper, drawn. */
export interface Paper {
  image: ImageBitmap
  /** The page's size in CSS pixels, which is what the note's own page is. */
  width: number
  height: number
}

/** One PDF, open, with the pages that have been drawn out of it.
 *
 *  One document per file however many pages ask for it: opening a PDF costs a
 *  worker and a copy of the bytes, and a note of four hundred pages is four hundred
 *  pages of one paper. */
interface Held {
  open: ReturnType<typeof openDocument>
  drawn: Map<number, Promise<Paper | null>>
  /** Which pages were asked for most recently, oldest first, so the ones nobody is
   *  looking at are the ones let go. */
  recent: number[]
}

const held = new Map<string, Held>()

/** The size of every page of a PDF, in CSS pixels, in order.
 *
 *  What an import asks before it writes anything: a page note made from a paper is
 *  the shape of that paper, page by page, so a landscape plate in the middle of a
 *  portrait book gets a landscape page. Nothing is drawn - a page's size is in its
 *  dictionary, so this is a read of the file and not a render of it, which is what
 *  makes it affordable for a book.
 *
 *  Rotation is already in what pdf.js reports, so a page scanned sideways comes back
 *  the way it is meant to be read. */
export async function pdfPageSizes(path: string): Promise<{ width: number; height: number }[]> {
  const opened = await openDocument(path)

  try {
    const sizes: { width: number; height: number }[] = []

    for (let number = 1; number <= opened.doc.numPages; number += 1) {
      const page = await opened.doc.getPage(number)
      const view = page.getViewport({ scale: PDF_TO_CSS })
      sizes.push({ width: Math.round(view.width), height: Math.round(view.height) })
      page.cleanup()
    }

    return sizes
  } finally {
    await opened.close().catch(() => undefined)
  }
}

/** One page of a paper as a picture, drawn now or already drawn.
 *
 *  Null where the paper is not there any more, cannot be read, or has no such page:
 *  a page note whose PDF somebody deleted is a note you can still read your own ink
 *  on, and a missing background is a blank sheet rather than an error over the
 *  writing. */
export function paperOf(path: string, number: number): Promise<Paper | null> {
  let one = held.get(path)
  if (!one) {
    one = { open: openDocument(path), drawn: new Map(), recent: [] }
    held.set(path, one)
  }

  const already = one.drawn.get(number)
  if (already) {
    touch(one, number)
    return already
  }

  const drawing = draw(one, number).catch(() => null)
  one.drawn.set(number, drawing)
  touch(one, number)
  forgetOldest(one)

  return drawing
}

function touch(one: Held, number: number) {
  const at = one.recent.indexOf(number)
  if (at >= 0) one.recent.splice(at, 1)
  one.recent.push(number)
}

/** The pages past the cap, let go of, oldest first. The bitmap is closed rather
 *  than only dropped: a bitmap holds its pixels outside the heap, and a collector
 *  has no reason to hurry about them. */
function forgetOldest(one: Held) {
  while (one.recent.length > KEPT) {
    const oldest = one.recent.shift()
    if (oldest === undefined) return

    const going = one.drawn.get(oldest)
    one.drawn.delete(oldest)
    void going?.then((paper) => paper?.image.close())
  }
}

async function draw(one: Held, number: number): Promise<Paper | null> {
  const opened = await one.open
  if (number < 1 || number > opened.doc.numPages) return null

  const page = await opened.doc.getPage(number)
  const wanted = page.getViewport({ scale: PDF_TO_CSS })

  // The scale asked for, brought down to what a texture may be. Rounded to the
  // page, so the bitmap is a whole number of pixels and the draw is not resampling
  // a fraction of one.
  const area = wanted.width * wanted.height * SCALE * SCALE
  const scale = area > MOST_PIXELS ? SCALE * Math.sqrt(MOST_PIXELS / area) : SCALE
  const view = page.getViewport({ scale: PDF_TO_CSS * scale })

  const paper = document.createElement('canvas')
  paper.width = Math.max(1, Math.round(view.width))
  paper.height = Math.max(1, Math.round(view.height))

  const ctx = paper.getContext('2d')
  if (!ctx) {
    page.cleanup()
    return null
  }

  await page.render({ canvas: paper, canvasContext: ctx, viewport: view }).promise
  page.cleanup()

  return {
    image: await createImageBitmap(paper),
    width: Math.round(wanted.width),
    height: Math.round(wanted.height),
  }
}

/** Everything drawn for one paper, let go of: the last page note showing it has
 *  closed. The document goes too, which is a worker and a copy of the bytes. */
export function forgetPaper(path: string) {
  const one = held.get(path)
  if (!one) return

  held.delete(path)
  for (const drawing of one.drawn.values()) void drawing.then((paper) => paper?.image.close())
  void one.open.then((opened) => opened.close()).catch(() => undefined)
}

/** And every paper, which is what signing out or closing the space means. */
export function forgetEveryPaper() {
  for (const path of [...held.keys()]) forgetPaper(path)
}
