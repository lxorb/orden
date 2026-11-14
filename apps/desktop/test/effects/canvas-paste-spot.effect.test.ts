import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Canvas from '../../src/lib/canvas/src/Canvas.svelte'
import { graphPoint } from '../../src/lib/camera'
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

let host: HTMLElement
let tab: Tab
let note: NoteDoc
let close: () => void

beforeEach(() => {
  vi.useFakeTimers()
  tools.choose('select')
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
  vi.useRealTimers()
})

function plane(): HTMLElement {
  const found = host.querySelector<HTMLElement>('.canvas')
  if (!found) throw new Error('no canvas')
  return found
}

function pointed(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 0 })
  Object.defineProperties(event, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } })
  plane().dispatchEvent(event)
  flushSync()
}

function pasted(text: string): { x: number; y: number } {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['text/plain'], files: [], items: [], getData: () => text },
  })
  plane().dispatchEvent(event)
  flushSync()
  vi.advanceTimersByTime(2000)
  const card = readCanvas(note.text).nodes.at(-1)
  if (!card) throw new Error('nothing pasted')
  return { x: card.x + card.width / 2, y: card.y + card.height / 2 }
}

function near(one: { x: number; y: number }, other: { x: number; y: number }) {
  expect(Math.abs(one.x - other.x)).toBeLessThan(40)
  expect(Math.abs(one.y - other.y)).toBeLessThan(40)
}

test('a paste lands under the arrow after the wheel scrolled the canvas beneath it', () => {
  pointed('pointermove', 100, 100)
  plane().dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 1000,
      clientX: 100,
      clientY: 100,
    }),
  )
  flushSync()
  const under = graphPoint(tab.camera ?? { x: 0, y: 0, scale: 1 }, 0, 0, 100, 100)
  near(pasted('hello'), under)
})

test('a paste with the arrow away from the canvas lands in the middle of the view', () => {
  pointed('pointermove', 100, 100)
  pointed('pointerleave', 100, 100)
  plane().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 1000 }))
  flushSync()
  const middle = graphPoint(tab.camera ?? { x: 0, y: 0, scale: 1 }, 0, 0, 0, 0)
  near(pasted('hello'), middle)
})
