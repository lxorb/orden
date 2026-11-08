import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import Canvas from '../../src/lib/Canvas.svelte'
import { emptyCanvas, writeCanvas } from '../../src/lib/canvas/format'
import { CanvasStore } from '../../src/lib/canvas/store.svelte'
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

let host: HTMLElement
let tab: Tab
let close: () => void

const points = [0, 1, 2, 3, 4].map((step) => ({
  x: 100 + step * 10,
  y: 100,
  pressure: 0.5,
  tiltX: 0,
  tiltY: 0,
  t: step,
}))

beforeEach(() => {
  tools.choose('lasso')
  const ink = [{ id: 's', tool: 'pen' as const, color: '#000000', size: 4, points }]
  const note = new NoteDoc(
    {
      kind: 'canvas',
      path: '/space/Board.canvas',
      name: 'Board.canvas',
      text: writeCanvas({ ...emptyCanvas(), ink }),
      dirty: false,
    },
    () => undefined,
  )
  tab = new Tab(note, 'pane')
  host = document.createElement('div')
  document.body.append(host)
  const shown = mount(Canvas, { target: host, props: { tab, focused: true } })
  close = () => void unmount(shown)
  flushSync()
})

afterEach(() => {
  close()
  host.remove()
})

function store(): CanvasStore {
  const found = CanvasStore.drawing(tab.note, [tab])
  if (!found) throw new Error('no canvas store')
  return found
}

function pointer(type: string, id: number, kind: string, x: number, y: number, buttons: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons })
  Object.defineProperties(event, {
    pointerType: { value: kind },
    pointerId: { value: id },
    pressure: { value: buttons ? 0.5 : 0 },
  })
  host.querySelector('.canvas')?.dispatchEvent(event)
  flushSync()
}

test('picked ink dragged moves by as much as dragged, though a palm or a second finger lifts on the way', () => {
  store().pickAll(['s'])
  flushSync()

  pointer('pointerdown', 1, 'pen', 120, 100, 1)
  pointer('pointermove', 1, 'pen', 135, 100, 1)
  pointer('pointermove', 1, 'pen', 150, 100, 1)
  pointer('pointerdown', 2, 'touch', 400, 400, 1)
  pointer('pointerup', 2, 'touch', 400, 400, 0)
  pointer('pointermove', 1, 'pen', 165, 100, 1)
  pointer('pointermove', 1, 'pen', 180, 100, 1)
  pointer('pointerup', 1, 'pen', 180, 100, 0)

  const first = store().canvas.ink[0]?.points[0]
  expect(first?.x).toBeCloseTo(160)
  expect(first?.y).toBeCloseTo(100)
})
