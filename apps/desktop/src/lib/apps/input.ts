/** What the holder does over an application's picture, as the events its host plays
 *  (issue 1063, step 4; `InputEvent` in `@orden/online/apps`): where the pointer is on
 *  the application's display, how far the wheel turned, and which key. */

import type { InputEvent } from '@orden/online/apps'

/** Where the picture is drawn in its element, which shows all of it at the largest size
 *  that fits (`object-fit: contain`): its left and top edge and its scale, in CSS pixels
 *  to the display's own. */
function drawn(box: DOMRectReadOnly, width: number, height: number) {
  const scale = Math.min(box.width / width, box.height / height)
  return {
    left: box.left + (box.width - width * scale) / 2,
    top: box.top + (box.height - height * scale) / 2,
    scale,
  }
}

/** The point of the display under a point of the page, kept on the display; null while
 *  the picture has no size yet. */
export function displayPoint(
  clientX: number,
  clientY: number,
  box: DOMRectReadOnly,
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0) return null
  const { left, top, scale } = drawn(box, width, height)
  const clamp = (value: number, most: number) => Math.min(Math.max(value, 0), most - 1)
  return {
    x: Math.round(clamp((clientX - left) / scale, width)),
    y: Math.round(clamp((clientY - top) / scale, height)),
  }
}

/** CSS pixels of a wheel that make one click of the display's wheel: a mouse's notch. */
const PIXELS_A_CLICK = 100
/** Lines that make one click, as most toolkits scroll three lines a click. */
const LINES_A_CLICK = 3

/** A wheel's turn, added up until it makes whole clicks: the clicks to send, and what is
 *  left over for the next turn. Precise scrolling comes with step 5. */
export function wheelClicks(
  left: { x: number; y: number },
  deltaX: number,
  deltaY: number,
  deltaMode: number,
): { x: number; y: number; left: { x: number; y: number } } {
  const per = deltaMode === 0 ? PIXELS_A_CLICK : deltaMode === 1 ? LINES_A_CLICK : 1
  const x = left.x + deltaX / per
  const y = left.y + deltaY / per
  // Never a negative zero, which reads as a turn the other way to nobody but a test.
  const whole = (value: number) => Math.trunc(value) || 0
  return { x: whole(x), y: whole(y), left: { x: x - whole(x), y: y - whole(y) } }
}

/** The key event a key gives, or null for a press the host is not sent: one in the
 *  middle of a composition (an input method's, step 5) and one the engine could not
 *  name. Every release is sent: the host lets go only of what it pressed. */
export function keyEvent(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'isComposing'>,
  down: boolean,
): InputEvent | null {
  const unsent =
    event.isComposing ||
    event.key === 'Dead' ||
    event.key === 'Process' ||
    event.key === 'Unidentified'
  if (down && unsent) return null
  return { t: 'key', key: event.key, code: event.code, down }
}
