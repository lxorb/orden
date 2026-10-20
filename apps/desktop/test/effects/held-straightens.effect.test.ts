/** A pen held still at the end of a stroke straightens it, when the pen never stops
 *  reporting (#629).
 *
 *  A mouse held still sends nothing, so the wait for a hold ran down under it. An S
 *  Pen in Chrome on a Galaxy Tab does not go quiet: it sends a move every few
 *  milliseconds as its pressure wanders and its tip shakes by a pixel, and the
 *  surface began the wait again on every one of them, so no line ever straightened.
 *  A pen that really moves on still must not be straightened under it.
 *
 *  In the jsdom project because it mounts the canvas and dispatches its events. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Canvas from '../../src/lib/Canvas.svelte'
import { blankCanvas, readCanvas } from '../../src/lib/canvas/format'
import { tools } from '../../src/lib/canvas/tools.svelte'
import { NoteDoc, Tab } from '../../src/lib/workspace/documents.svelte'

/** jsdom implements none of these, and a mounted canvas asks for all three. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
Element.prototype.hasPointerCapture = () => false
globalThis.ResizeObserver = class {
  observe() {
    // jsdom does no layout: nothing is measured here.
  }
  unobserve() {
    // Said above.
  }
  disconnect() {
    // Said above.
  }
}

/** How far apart the pen's events come, in milliseconds. */
const FRAME = 16
/** The pressure a straightened stroke is laid at all the way along; see tidyShape in
 *  canvas/ink.ts. A stroke left as it was drawn keeps the pen's own. */
const EVEN = 0.6

let host: HTMLElement
let note: NoteDoc
let close: () => void

beforeEach(() => {
  vi.useFakeTimers()
  tools.choose('draw')
  note = new NoteDoc(
    {
      kind: 'canvas',
      path: '/space/Board.canvas',
      name: 'Board.canvas',
      text: blankCanvas(),
      dirty: false,
    },
    () => undefined,
  )
  host = document.createElement('div')
  document.body.append(host)
  const shown = mount(Canvas, {
    target: host,
    props: { tab: new Tab(note, 'pane'), focused: true },
  })
  close = () => void unmount(shown)
  flushSync()
})

afterEach(() => {
  close()
  host.remove()
  vi.useRealTimers()
})

/** One event from an S Pen on the glass, as Chrome sends it. */
function pen(type: string, x: number, y: number, pressure: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 })
  Object.defineProperties(event, {
    pointerType: { value: 'pen' },
    pointerId: { value: 7 },
    pressure: { value: pressure },
  })
  host.querySelector('.canvas')?.dispatchEvent(event)
}

/** A line drawn across, then whatever the pen does at the end of it, then lifted:
 *  the points of the stroke that was put down. */
function drawn(after: (frame: number) => { x: number; y: number }, frames: number) {
  pen('pointerdown', 100, 100, 0.3)
  for (let x = 110; x <= 300; x += 10) {
    vi.advanceTimersByTime(FRAME)
    pen('pointermove', x, 100, 0.3)
  }
  for (let frame = 0; frame < frames; frame++) {
    vi.advanceTimersByTime(FRAME)
    const { x, y } = after(frame)
    pen('pointermove', x, y, 0.3 + (frame % 3) / 10)
  }
  pen('pointerup', 300, 100, 0)
  flushSync()
  // The file catches up with the plane a moment later; see `edit` in store.svelte.ts.
  vi.advanceTimersByTime(3000)
  return readCanvas(note.text).ink[0]?.points
}

test('a pen held still while it shakes by a pixel or two straightens the line', () => {
  const points = drawn((frame) => ({ x: 300 + (frame % 2) * 2, y: 100 + (frame % 3) }), 40)

  expect(points?.[0]?.pressure).toBe(EVEN)
})

test('a pen still moving on, a little at a time, is not straightened', () => {
  // Eight pixels further every quarter of a second: never still for as long as a hold.
  const points = drawn((frame) => ({ x: 300 + Math.floor(frame / 15) * 8, y: 100 }), 60)

  expect(points?.[0]?.pressure).toBe(0.3)
})
