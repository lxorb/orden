import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Canvas from '../../src/lib/Canvas.svelte'
import { blankCanvas, readCanvas } from '../../src/lib/canvas/format'
import { tools } from '../../src/lib/canvas/tools.svelte'
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

const FRAME = 16
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

function pen(type: string, x: number, y: number, pressure: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 })
  Object.defineProperties(event, {
    pointerType: { value: 'pen' },
    pointerId: { value: 7 },
    pressure: { value: pressure },
  })
  host.querySelector('.canvas')?.dispatchEvent(event)
}

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
  vi.advanceTimersByTime(3000)
  return readCanvas(note.text).ink[0]?.points
}

test('a pen held still while it shakes by a pixel or two straightens the line', () => {
  const points = drawn((frame) => ({ x: 300 + (frame % 2) * 2, y: 100 + (frame % 3) }), 40)

  expect(points?.[0]?.pressure).toBe(EVEN)
})

test('a pen still moving on, a little at a time, is not straightened', () => {
  const points = drawn((frame) => ({ x: 300 + Math.floor(frame / 15) * 8, y: 100 }), 60)

  expect(points?.[0]?.pressure).toBe(0.3)
})
