/** The page the glasses hold, and how a drawn page reaches it.
 *
 *  Five containers, made once and never rebuilt. Four image containers tile the
 *  whole panel, because an image container may be at most 288 by 144 and the
 *  panel is 576 by 288; a full-screen text container sits behind them and is the
 *  one that captures input, which is the layering the platform's own docs
 *  prescribe for an app that draws. Never rebuilt because a rebuild costs a flat
 *  165 ms and a page turn should not pay it.
 *
 *  A page turn sends only the containers whose pixels moved. A container starts
 *  empty and every empty quadrant hashes alike, so the two thirds of a page of
 *  prose that are dark cost nothing at all. See docs/even.md for the arithmetic.
 *
 *  When the image channel dies - a documented fault after the leave-this-app
 *  question has been up, after which every image send fails for the life of the
 *  app - the note is put into the text container as words instead. It loses the
 *  faces, the code colours and the tables, and it is still the note. */

import { BLANK, PANEL_HEIGHT, PANEL_WIDTH, type Page, QUADRANTS, type Sheets } from '@nib/glasses'
import type { Container, Glasses } from './sdk'
import type { Screen, Showing } from './session'

/** The layer that collects every gesture. One container per page may capture,
 *  and an image container may not, so this is it. Its content is a single space:
 *  nothing to read, and no overflow, so a swipe is at both ends of it at once
 *  and reaches us instead of scrolling something invisible. */
const CAPTURE: Container = { id: 1, name: 'nib' }
const EMPTY = ' '

/** The four containers the page is drawn into, in reading order. They are sent
 *  in this order too, because the glasses reveal each as it lands. */
const TILES: readonly Container[] = QUADRANTS.map((_one, at) => ({
  id: 11 + at,
  name: `nib${at + 1}`,
}))

/** What `createStartUpPageContainer` is given.
 *
 *  A plain object: the host reads it through the SDK's own static mapper, which
 *  takes one. `zOrderIndex` is all or nothing for a page, so all five carry one,
 *  with the capture layer underneath. */
function skeleton(): unknown {
  return {
    containerTotalNum: 1 + TILES.length,
    textObject: [
      {
        ...CAPTURE,
        containerID: CAPTURE.id,
        containerName: CAPTURE.name,
        xPosition: 0,
        yPosition: 0,
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        isEventCapture: 1,
        zOrderIndex: 0,
        content: EMPTY,
      },
    ],
    imageObject: QUADRANTS.map((quadrant, at) => ({
      containerID: TILES[at]?.id,
      containerName: TILES[at]?.name,
      xPosition: quadrant.x,
      yPosition: quadrant.y,
      width: quadrant.width,
      height: quadrant.height,
      zOrderIndex: at + 1,
    })),
  }
}

/** A page as words, for the text container to fall back to. */
function wordsOf(page: Page): string {
  return page.lines
    .map((line) => line.placed.map((one) => one.run.over ?? one.run.text).join(''))
    .join('\n')
    .trim()
}

/** What `textContainerUpgrade` will take at once. */
const WORD_LIMIT = 2000

export class Panel implements Screen {
  /** What each container is showing, by its hash. Every container starts empty,
   *  and an empty quadrant hashes to the same thing, so nothing dark is ever
   *  sent to a container that is already dark. */
  private readonly held = TILES.map(() => BLANK)
  /** True once the image channel has failed in the way no retry helps. */
  private drawnOut = false
  private started = false

  constructor(
    private readonly glasses: Glasses,
    private readonly sheets: Sheets,
  ) {}

  /** Makes the page. Called once; a second call is refused by the host, and
   *  refused after blocking for a couple of seconds, so what is latched here is
   *  that it was called rather than that it worked. */
  async open(): Promise<boolean> {
    if (this.started) return true

    this.started = true
    return this.glasses.start(skeleton())
  }

  async show(page: Page, showing: Showing): Promise<void> {
    if (this.drawnOut) return this.write(page)

    const sheet = await this.sheets.sheet(page, `${showing.page + 1}/${showing.count}`)
    if (!sheet) return this.write(page)

    // One at a time. Concurrent sends are not allowed, and the glasses reveal
    // each container as it lands, so in reading order the page fills the way a
    // page is read.
    for (const quadrant of sheet.quadrants) {
      if (this.held[quadrant.at] === quadrant.hash) continue

      const container = TILES[quadrant.at]
      if (!container) continue

      const sent = await this.glasses.image(container, quadrant.bytes)
      if (sent === 'ok') {
        this.held[quadrant.at] = quadrant.hash
        continue
      }

      if (sent === 'dead') {
        this.drawnOut = true
        return this.write(page)
      }

      // Worth one more try, and then left: the next page turn will bring it
      // round again, and a half-drawn page is better than a stalled one.
      const again = await this.glasses.image(container, quadrant.bytes)
      if (again === 'ok') this.held[quadrant.at] = quadrant.hash
      else if (again === 'dead') {
        this.drawnOut = true
        return this.write(page)
      }
    }
  }

  /** The page as words in the capture layer. The fallback, and the only thing
   *  the glasses can be given when there is no canvas to draw on. */
  private async write(page: Page): Promise<void> {
    await this.glasses.words(CAPTURE, wordsOf(page).slice(0, WORD_LIMIT) || EMPTY)
  }
}
