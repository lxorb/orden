/** A note, into what the four containers on the glasses are sent.
 *
 *  The one door. Everything before it - the grammar, the greys, the wrapping,
 *  the pages, the canvas - is a step this puts in order, and what comes out is a
 *  page's worth of bytes per container plus enough about each of them for a
 *  caller to know which ones changed.
 *
 *  Kept by hash. A page's pixels are decided entirely by its lines, so the hash
 *  over those lines is the cache key: scrolling back to a page costs nothing,
 *  and an edit that leaves a page alone leaves its bytes alone too. */

import type { CodePalette, LigatureScope } from '@nib/editor'
import { blocksOf, familiesUsed, fenceLanguagesIn } from './blocks'
import { fenceSpans, loadFenceParsers, type Parser } from './code'
import { packGray4, type Tile } from './encode'
import { hashOfBytes } from './hash'
import { type Page, pagesOf } from './layout'
import { ruler } from './measure'
import { drawnIn, Painter, type PainterOptions, QUADRANTS, quadrantsOf } from './raster'

/** The two settings of the account that change what a note looks like. */
export interface Look {
  scope: LigatureScope
  palette: CodePalette
}

export interface SheetOptions extends PainterOptions {
  /** What the containers are sent.
   *
   *  `png` is the documented path: the host decodes the file, scales it and does
   *  its own reduction to four bits, which its own docs say is better than one
   *  done here. `gray4` hands it the packed nibbles instead, which skips a
   *  decode but rests on a byte layout nobody has published; see encode.ts and
   *  docs/even.md. */
  format?: 'png' | 'gray4'
  /** How many pages of bytes to keep. Each page is four containers of 20 KB, so
   *  this is the memory the plugin holds for scrolling back. */
  keep?: number
}

/** One container's share of a page. */
export interface Quadrant {
  /** The container this belongs to; the index into `QUADRANTS`. */
  at: number
  /** What to send. */
  bytes: Uint8Array
  /** True when there is nothing on it at all. A container starts empty, so a
   *  blank quadrant on the first page of a note needs no send; see `BLANK`. */
  blank: boolean
  /** Of the pixels, so a caller can tell this from what it sent last. Every
   *  blank quadrant hashes to the same thing on purpose: two thirds of a page of
   *  prose is empty, and a page turn should not spend a fifth of a second
   *  sending the same darkness twice. */
  hash: string
}

/** The hash every empty container shares, and the state a container is in
 *  before anything has been sent to it. */
export const BLANK = 'blank'

export interface Sheet {
  /** The page's own hash, which is the key this was kept under. */
  hash: string
  quadrants: Quadrant[]
}

/** Under a name a profiler and a test can both read. */
const MEASURE = 'nib:glasses'

export class Sheets {
  private readonly painter: Painter | null
  private readonly parsers = new Map<string, Parser>()
  private readonly sheets = new Map<string, Sheet>()
  private readonly format: 'png' | 'gray4'
  private readonly keep: number

  constructor(options: SheetOptions = {}) {
    this.painter = Painter.create(options)
    this.format = options.format ?? 'png'
    this.keep = options.keep ?? 8
  }

  /** False where there is no canvas to draw on, which is every context that is
   *  not a browser. The pages still come out, measured against the ruler in
   *  measure.ts, so a page count and a page map are available without one. */
  get drawing(): boolean {
    return this.painter !== null
  }

  /** A note as pages. Waits for the faces and for every formula and picture in
   *  it, then lays it out; see `prepare` in raster.ts. */
  async pages(source: string, look: Look): Promise<Page[]> {
    const wanted = fenceLanguagesIn(source)
    const missing = wanted.filter((name) => !this.parsers.has(name))
    if (missing.length) {
      for (const [name, parser] of await loadFenceParsers(missing)) this.parsers.set(name, parser)
    }

    const at = performance.now()
    const blocks = blocksOf(source, {
      scope: look.scope,
      fence: (code, language) => fenceSpans(code, this.parsers.get(language)),
    })

    if (this.painter) await this.painter.prepare(drawnIn(blocks), familiesUsed(blocks))

    const pages = pagesOf(blocks, source.length, {
      scope: look.scope,
      palette: look.palette,
      measure: this.painter ?? ruler(),
      fence: () => [],
    })

    performance.measure(MEASURE, {
      start: at,
      detail: { bytes: source.length, pages: pages.length },
    })

    return pages
  }

  /** What the four containers get for this page. `mark` is the page count drawn
   *  in the band along the bottom; it is part of the picture, so it is part of
   *  the key this is kept under. */
  async sheet(page: Page, mark = ''): Promise<Sheet | null> {
    const key = `${page.hash}:${mark}`
    const kept = this.sheets.get(key)
    if (kept) return kept

    if (!this.painter) return null

    const panel = this.painter.draw(page, mark)
    const tiles = quadrantsOf(panel)
    const quadrants: Quadrant[] = []

    for (let at = 0; at < QUADRANTS.length; at++) {
      const tile = tiles[at]
      if (!tile) continue

      quadrants.push(await this.quadrant(at, tile))
    }

    const sheet: Sheet = { hash: key, quadrants }
    this.sheets.set(key, sheet)

    // Oldest first, which is what a Map's own order gives.
    while (this.sheets.size > this.keep) {
      const oldest = this.sheets.keys().next().value
      if (oldest === undefined) break
      this.sheets.delete(oldest)
    }

    return sheet
  }

  private async quadrant(at: number, tile: Tile): Promise<Quadrant> {
    const blank = tile.levels.every((level) => level === 0)
    const bytes =
      this.format === 'gray4' ? packGray4(tile) : ((await this.painter?.png(at)) ?? packGray4(tile))

    return { at, bytes, blank, hash: blank ? BLANK : hashOfBytes(tile.levels) }
  }
}
