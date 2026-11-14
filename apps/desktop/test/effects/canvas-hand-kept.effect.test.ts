import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import Canvas from '../../src/lib/canvas/src/Canvas.svelte'
import { emptyCanvas, writeCanvas } from '@orden/markdown/canvas'
import { CanvasStore } from '../../src/lib/canvas/src/store.svelte'
import { tools } from '../../src/lib/canvas/src/tools.svelte'
import type { Point } from '@orden/markdown/plane'
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

const said: (Point | null)[] = []

beforeEach(() => {
  tools.choose('draw')
  said.length = 0
  const note = new NoteDoc(
    {
      kind: 'canvas',
      path: '/space/Board.canvas',
      name: 'Board.canvas',
      text: writeCanvas(emptyCanvas()),
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

  const found = CanvasStore.drawing(tab.note, [tab])
  if (!found) throw new Error('no canvas store')
  found.shared = {
    push: () => undefined,
    undo: () => false,
    redo: () => false,
    hand: (at) => void said.push(at),
  }
  flushSync()
})

afterEach(() => {
  close()
  host.remove()
})

function pointer(type: string, kind: string, x: number, buttons: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 100, buttons })
  Object.defineProperties(event, {
    pointerType: { value: kind },
    pointerId: { value: kind === 'mouse' ? 1 : 2 },
    pressure: { value: buttons ? 0.5 : 0 },
  })
  host.querySelector('.canvas')?.dispatchEvent(event)
  flushSync()
}

test('a pen lifted off the plane leaves its hand where it stopped, for the others to see', () => {
  pointer('pointerdown', 'pen', 120, 1)
  pointer('pointermove', 'pen', 160, 1)
  pointer('pointerup', 'pen', 160, 0)
  pointer('pointerleave', 'pen', 160, 0)

  expect(said.at(-1)).not.toBeNull()
})

test('a mouse that leaves the plane takes its hand with it', () => {
  pointer('pointermove', 'mouse', 140, 0)
  expect(said.at(-1)).not.toBeNull()

  pointer('pointerleave', 'mouse', 140, 0)
  expect(said.at(-1)).toBeNull()
})
