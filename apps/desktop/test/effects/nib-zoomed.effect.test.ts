/** Zoomed in, the dot under the pointer is as wide as the line the pen writes (#644).
 *
 *  Past 100% a pen writes at its width divided by the zoom, so the line is as wide on
 *  the screen as the pen is set to (#369). The dot was still the pen's width times the
 *  zoom: at 200% it promised a line twice as fat as the one that came out, and the
 *  pen's width seemed to change with the zoom.
 *
 *  In the jsdom project because it mounts the canvas and reads what it wears. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import Canvas from '../../src/lib/Canvas.svelte'
import { blankCanvas } from '../../src/lib/canvas/format'
import { pens } from '../../src/lib/canvas/pens.svelte'
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

/** A pen wide enough that the dot is not held to its smallest. */
const WIDE = 20

let host: HTMLElement
let close: () => void

beforeEach(() => {
  tools.choose('draw')
  pens.set({ size: WIDE })
  const note = new NoteDoc(
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
})

/** How wide the dot the cursor draws is, in pixels. */
function dot(): number {
  const svg = decodeURIComponent(host.querySelector<HTMLElement>('.canvas')?.style.cursor ?? '')
  return Number(/r="([\d.]+)"/.exec(svg)?.[1]) * 2
}

test('zoomed in, the dot stays the width the pen writes on the screen', () => {
  expect(dot()).toBe(WIDE)

  host
    .querySelector('.canvas')
    ?.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true }))
  flushSync()

  expect(dot()).toBe(WIDE)
})
