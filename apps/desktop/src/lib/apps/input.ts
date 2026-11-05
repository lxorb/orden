/** What the holder does over an application's picture, as the events its host plays
 *  (issue 1063, steps 4 and 5; `InputEvent` in `@orden/online/apps`): where the pointer
 *  is on the application's display, how far the wheel turned, which key, and the text an
 *  input method made. And the application's pointer, as the tab draws it. */

import type { InputEvent, PointerShape } from '@orden/online/apps'

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
 *  left over for the next turn. A touchpad's fine scrolling adds up the same way: X's
 *  wheel turns in clicks and nothing finer, and what is left over is never lost. */
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
 *  middle of a composition (an input method's, whose text comes once it is chosen,
 *  `textEvent`) and one the engine could not name. Every release is sent: the host lets
 *  go only of what it pressed. */
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

/** Whether a key is a paste: Ctrl or Command with V, or Shift with Insert. Its press is
 *  held back until the page has read the clipboard for it, which goes to the host
 *  first, so the application pastes what this device copied. */
export function isPaste(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
): boolean {
  const v = event.key === 'v' || event.key === 'V'
  return ((event.ctrlKey || event.metaKey) && v) || (event.shiftKey && event.key === 'Insert')
}

/** The text an input method made, as the host types it; null for none. */
export function textEvent(text: string | null | undefined): InputEvent | null {
  return text ? { t: 'text', text } : null
}

/** Whether a pointer's event is one the application is given: a mouse's, a pen's, or
 *  the first finger's. X has one pointer, so a second finger is not passed on. */
export function drivesPointer(event: Pick<PointerEvent, 'isPrimary'>): boolean {
  return event.isPrimary
}

/** The keys held down, by the key each was, so that the tab losing the keyboard - the
 *  window left with Alt held - lets them go rather than leaving them held in the
 *  application. */
export class HeldKeys {
  private readonly held = new Set<string>()

  /** Notes a key event sent. */
  saw(event: InputEvent): void {
    if (event.t !== 'key') return
    if (event.down) this.held.add(event.code)
    else this.held.delete(event.code)
  }

  /** The releases of every key still held, which are then held no longer. */
  letGo(): InputEvent[] {
    const all = [...this.held].map((code): InputEvent => ({ t: 'key', key: '', code, down: false }))
    this.held.clear()
    return all
  }
}

/** The CSS for the pointer over the picture: the application's shape at the tab's
 *  ratio, its hot spot in CSS pixels, or none when the application hid it; the
 *  engine's own until the host has said. */
export function pointerStyle(pointer: PointerShape | null, dpr: number): string {
  if (!pointer) return ''
  if ('hidden' in pointer) return 'none'
  const ratio = dpr > 0 ? dpr : 1
  const x = Math.round(pointer.x / ratio)
  const y = Math.round(pointer.y / ratio)
  return `-webkit-image-set(url("${pointer.png}") ${ratio}x) ${x} ${y}, default`
}
