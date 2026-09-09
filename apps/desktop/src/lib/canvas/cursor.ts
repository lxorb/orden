/** What the pointer looks like over the plane.
 *
 *  A mouse hand should never have to look at the bar to know what a press will do.
 *  So the pointer itself says it: an arrow arranges, an open hand moves the page, a
 *  nib in the pen's own colour writes, a ring the width of the eraser rubs out, and
 *  a corner handle wears the arrow that says which way it pulls.
 *
 *  Two of them are drawn rather than named, because no cursor keyword can say
 *  "this wide, in this colour": the eraser's ring and the pen's nib are small SVGs
 *  built here from the tool as it stands, so turning the width dial changes the
 *  cursor while the slider is still moving. Everything else is a keyword, because a
 *  keyword is the one the reader's own system draws.
 *
 *  Pure, and its own file, so what the pointer says is a table rather than a pile
 *  of class names. A touch screen has no cursor at all and asks nothing of this;
 *  the eraser shows its ring on the plane instead, under the finger. */

import type { HandleId } from './geometry'

/** How big a cursor a browser will draw. Chromium ignores anything past 128 pixels
 *  and falls back to the default, which would be worse than a smaller ring, so a
 *  fat eraser is drawn as big as it may be and says so by being drawn at all. */
const BIGGEST = 120

/** What the pointer is over, as far as the cursor cares. */
export type Over = HandleId | 'port' | 'turn' | 'thing' | null

/** Everything the cursor is worked out from. */
export interface Look {
  /** What the bar is holding. */
  tool: 'select' | 'hand' | 'draw' | 'erase' | 'lasso' | 'put'
  /** Whether a gesture is under way, which is what turns a grab into a grabbing. */
  busy: boolean
  /** Whether the plane is being held: space, or the middle button. */
  holding: boolean
  /** What is under the pointer. */
  over: Over
  /** The pen as it stands: how wide on screen, and in what colour. */
  nib: { size: number; colour: string }
  /** The eraser as it stands: how wide on screen, and whether it takes whole
   *  strokes rather than a hole. */
  rub: { size: number; whole: boolean }
}

/** Which resize cursor a handle wears: the one that points the way it pulls. */
const PULLS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}

/** The cursor for the plane, as a `cursor` value.
 *
 *  What is under the pointer wins over what the bar holds, but only for the arrow:
 *  a pen over a corner handle is still a pen, because a pen does not resize
 *  anything. */
export function cursorFor(look: Look): string {
  if (look.holding) return look.busy ? 'grabbing' : 'grab'

  switch (look.tool) {
    case 'hand':
      return look.busy ? 'grabbing' : 'grab'
    case 'draw':
      return nibCursor(look.nib.size, look.nib.colour)
    case 'erase':
      return rubCursor(look.rub)
    case 'lasso':
    case 'put':
      return 'crosshair'
    case 'select':
      break
  }

  if (look.over === 'port') return 'pointer'
  if (look.over === 'turn') return 'grab'
  if (look.over === 'thing') return 'move'
  if (look.over) return PULLS[look.over]

  return 'default'
}

/** A small dot in the pen's own colour, at the width the nib will actually draw, so
 *  a fat marker has a fat dot and a fine biro a fine one. Never smaller than
 *  something a hand can see, and never so big it hides what is under it. */
export function nibCursor(size: number, colour: string): string {
  const across = Math.min(BIGGEST, Math.max(6, Math.round(size)))
  const room = across + 4
  const middle = room / 2

  // A ring round the dot in the page's own two colours, so a nib the colour of
  // whatever is under it is still visible on it.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${room}" height="${room}">` +
    `<circle cx="${middle}" cy="${middle}" r="${across / 2}" fill="${escaped(colour)}"` +
    ` stroke="#fff" stroke-width="1" stroke-opacity="0.85"/>` +
    `<circle cx="${middle}" cy="${middle}" r="${across / 2 + 1}" fill="none"` +
    ` stroke="#000" stroke-width="0.75" stroke-opacity="0.4"/>` +
    `</svg>`

  return `${drawn(svg)} ${Math.round(middle)} ${Math.round(middle)}, crosshair`
}

/** The eraser as the ring it is: exactly as wide on the screen as the hole it will
 *  rub, so nothing has to be guessed from a number. The stroke eraser has no width
 *  to show - it takes whatever line it touches, whole - so it is a small ring that
 *  says "a touch is enough". */
export function rubCursor(rub: { size: number; whole: boolean }): string {
  const across = rub.whole ? 12 : Math.min(BIGGEST, Math.max(6, Math.round(rub.size * 2)))
  const room = across + 4
  const middle = room / 2

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${room}" height="${room}">` +
    `<circle cx="${middle}" cy="${middle}" r="${across / 2}" fill="#fff" fill-opacity="0.18"` +
    ` stroke="#000" stroke-width="2" stroke-opacity="0.45"${rub.whole ? ' stroke-dasharray="3 2"' : ''}/>` +
    `<circle cx="${middle}" cy="${middle}" r="${across / 2 - 1}" fill="none"` +
    ` stroke="#fff" stroke-width="1" stroke-opacity="0.9"${rub.whole ? ' stroke-dasharray="3 2"' : ''}/>` +
    `</svg>`

  return `${drawn(svg)} ${Math.round(middle)} ${Math.round(middle)}, crosshair`
}

/** An SVG as a cursor. Encoded rather than base64: it is shorter, it stays
 *  readable in the inspector, and a cursor is rebuilt on every turn of the width
 *  dial. */
function drawn(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** A colour into an attribute. A canvas may have arrived from a room, a share or a
 *  paste, so what a file called a colour can never end the attribute it is written
 *  in - or the whole cursor becomes a string the browser drops. */
function escaped(colour: string): string {
  return colour.replace(/[^#a-zA-Z0-9(),.%\s-]/g, '')
}
