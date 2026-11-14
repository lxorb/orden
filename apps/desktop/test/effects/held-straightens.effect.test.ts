import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Canvas from '../../src/lib/canvas/src/Canvas.svelte'
import { blankCanvas, readCanvas } from '@orden/markdown/canvas'
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

function pen(type: string, x: number, y: number, pressure: number, kind = 'pen', id = 7) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 })
  Object.defineProperties(event, {
    pointerType: { value: kind },
    pointerId: { value: id },
    pressure: { value: pressure },
    tiltX: { value: 0 },
    tiltY: { value: 0 },
  })
  host.querySelector('.canvas')?.dispatchEvent(event)
}

function drawn(after: (frame: number) => { x: number; y: number }, frames: number, palm = false) {
  pen('pointerdown', 100, 100, 0.3)
  if (palm) pen('pointerdown', 600, 500, 0.5, 'touch', 9)
  for (let x = 110; x <= 300; x += 10) {
    vi.advanceTimersByTime(FRAME)
    pen('pointermove', x, 100, 0.3)
  }
  for (let frame = 0; frame < frames; frame++) {
    vi.advanceTimersByTime(FRAME)
    const { x, y } = after(frame)
    pen('pointermove', x, y, 0.3 + (frame % 3) / 10)
    if (palm) pen('pointermove', 600 + (frame % 5) * 20, 500, 0.5, 'touch', 9)
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

test('a palm resting and shifting on the screen beside the pen leaves the held line to straighten', () => {
  const points = drawn((frame) => ({ x: 300 + (frame % 2) * 2, y: 100 + (frame % 3) }), 40, true)

  expect(points?.[0]?.pressure).toBe(EVEN)
})

test('a palm the system cancels beside the pen leaves the held line to straighten', () => {
  const points = drawn(
    (frame) => {
      if (frame === 20) pen('pointercancel', 600, 500, 0, 'touch', 9)
      return { x: 300 + (frame % 2) * 2, y: 100 + (frame % 3) }
    },
    40,
    true,
  )

  expect(points?.[0]?.pressure).toBe(EVEN)
})

test('a palm put down while the pen draws leaves the line its own clock', () => {
  pen('pointerdown', 100, 100, 0.3)
  for (let x = 110; x <= 300; x += 10) {
    vi.advanceTimersByTime(FRAME)
    if (x === 200) pen('pointerdown', 600, 500, 0.5, 'touch', 9)
    pen('pointermove', x, 100 + (x % 30), 0.3)
  }
  pen('pointerup', 300, 100, 0)
  flushSync()
  vi.advanceTimersByTime(3000)

  const times = readCanvas(note.text).ink[0]?.points.map((point) => point.t) ?? []
  expect(times.length).toBeGreaterThan(3)
  expect(times.every((time, at) => at === 0 || time >= (times[at - 1] ?? 0))).toBe(true)
})
