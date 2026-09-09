/** Nib on the Even Realities G2, in text.
 *
 *  A note as pages of words for a 576 by 288 panel that has exactly one font in
 *  exactly one size, and a mapping from every construct in a note to something
 *  that font can draw. Pure, with no DOM and no canvas in it, so all of it is
 *  tested without a browser.
 *
 *  See docs/even.md for the panel, the mapping table, and why the glasses are
 *  written to rather than drawn on. */

export { fit, fold, rightward, rows, ruleOf, SPACE, spread, TICK, width, wrap } from './firmware'
export { type Line, markLines } from './mark'
export { type Page, pageAt, pageOfLine, pagesOf, type Paging } from './pages'
export {
  type Band,
  type BandName,
  bandsOf,
  BODY_INNER,
  BODY_ROWS,
  BRIGHT,
  LINE,
  PANEL_HEIGHT,
  PANEL_WIDTH,
} from './panel'
