import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import Canvas from '../../src/lib/canvas/src/Canvas.svelte'
import { blankCanvas } from '@orden/markdown/canvas'
import { pens } from '../../src/lib/canvas/src/pens.svelte'
import { tools } from '../../src/lib/canvas/src/tools.svelte'
import { NoteDoc, Tab } from '../../src/lib/workspace/documents.svelte'

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
