/** What the G2 panel is, in numbers.
 *
 *  One place for them because every other file here derives from these: the
 *  measurer asks for the text width, the page filler asks for the height, the
 *  encoder asks how many bits a pixel gets. A panel with other numbers is this
 *  file and nothing else. */

/** The whole canvas the glasses draw, in pixels. Wide and short, which is the
 *  one fact that shapes the whole layout: a note is set across the full width
 *  rather than in a column down the middle, because a column down the middle
 *  would throw away two thirds of the glass. */
export const PANEL_WIDTH = 576
export const PANEL_HEIGHT = 288

/** How many grey levels a pixel can be. Four bits a pixel, so sixteen: nothing
 *  lit through to full brightness. See `encode.ts` for how they are packed. */
export const GREY_LEVELS = 16
/** The brightest a pixel goes, and the level that is simply off. */
export const WHITE = GREY_LEVELS - 1
export const BLACK = 0

/** Room around the text. Small on purpose: the panel is already short, and the
 *  glasses put their own margin around it optically. Left and right are equal
 *  so a line starts where the eye expects it and runs to the far edge. */
export const MARGIN_X = 10
export const MARGIN_TOP = 6
/** Deeper than the top, because the band along the bottom carries the page
 *  count. It costs half a line of prose and it is the only thing on the panel
 *  that is not the note, which is a trade worth making: a reader turning pages
 *  with their thumb on a temple has no other way to know where they are. */
const MARGIN_BOTTOM = 14

export const TEXT_WIDTH = PANEL_WIDTH - 2 * MARGIN_X
export const TEXT_HEIGHT = PANEL_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM

/** The size body text is set at.
 *
 *  Chosen from the character count rather than from taste: the content face
 *  averages a little under half its size per character, so 16 px puts roughly
 *  70 characters on a 556 px line, which is the measure a page of prose wants
 *  and the number the panel can carry without turning grey mush. Headings and
 *  code step off this; see `styles.ts`. */
export const BODY_SIZE = 16

/** Line height as a multiple of the size. 1.3 rather than the app's 1.72: the
 *  panel has 276 usable pixels, and every tenth of leading costs a line of the
 *  note. At 1.3 a page holds thirteen lines of prose. */
export const LINE_RATIO = 1.3

/** How many characters a line of body text is expected to hold. Not used to
 *  lay anything out - the measurer does that - but asserted by a test, so a
 *  change to the size or the margins that walks out of the readable band
 *  fails rather than ships. */
export const CHARACTERS_PER_LINE = { least: 60, most: 80 } as const
