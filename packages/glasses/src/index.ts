/** Nib on the Even Realities G2.
 *
 *  A note as pages for a 576 by 288 panel of sixteen greys: the app's own
 *  grammar, the app's own faces, the code theme's colours turned into greys, and
 *  the same ligature glyphs the editor draws. Everything but `raster.ts` and
 *  `fonts.ts` is pure, so the layout can be tested without a browser.
 *
 *  See docs/even.md for what the panel is, what it costs to send a page to it,
 *  and why a page is drawn rather than written into a text container. */

export { type Page, pageAt } from './layout'
export { PANEL_HEIGHT, PANEL_WIDTH } from './panel'
export { QUADRANTS } from './raster'
export { BLANK, type Look, type Quadrant, type Sheet, Sheets } from './sheets'
