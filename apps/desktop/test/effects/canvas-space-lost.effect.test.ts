import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import Canvas from '../../src/lib/Canvas.svelte'
import { blankCanvas } from '../../src/lib/canvas/format'
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

beforeEach(() => {
  tools.choose('select')
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

function plane(): HTMLElement {
  const found = host.querySelector<HTMLElement>('.canvas')
  if (!found) throw new Error('no canvas')
  return found
}

function mouse(type: string, x: number, y: number, buttons: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons })
  Object.defineProperties(event, {
    pointerType: { value: 'mouse' },
    pointerId: { value: 1 },
  })
  plane().dispatchEvent(event)
  flushSync()
}

function dragged(): { x: number; y: number } {
  const was = { x: tab.camera?.x ?? 0, y: tab.camera?.y ?? 0 }
  mouse('pointerdown', 100, 100, 1)
  for (let x = 120; x <= 300; x += 20) mouse('pointermove', x, 100, 1)
  mouse('pointerup', 300, 100, 0)
  return { x: (tab.camera?.x ?? 0) - was.x, y: (tab.camera?.y ?? 0) - was.y }
}

function space(type: string, target: EventTarget = plane()) {
  target.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: ' ', code: 'Space' }))
  flushSync()
}

test('a held space pans a drag with the arrow', () => {
  space('keydown')
  expect(dragged().x).not.toBe(0)
  space('keyup')
  expect(dragged()).toEqual({ x: 0, y: 0 })
})

test('a space whose release the window never heard, having lost focus, stops panning', () => {
  space('keydown')
  window.dispatchEvent(new FocusEvent('blur'))
  flushSync()
  expect(dragged()).toEqual({ x: 0, y: 0 })
})

test('a space let go while focus is elsewhere in the window stops panning', () => {
  space('keydown')
  const field = document.createElement('textarea')
  document.body.append(field)
  plane().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: field }))
  flushSync()
  space('keyup', field)
  field.remove()
  expect(dragged()).toEqual({ x: 0, y: 0 })
})

function reached(button: HTMLElement, byKeys: boolean) {
  const own = button.matches.bind(button)
  button.matches = (selector: string) => (selector === ':focus-visible' ? byKeys : own(selector))
  button.focus()
}

function bar(): HTMLElement {
  const found = host.querySelector<HTMLElement>('.canvas button')
  if (!found) throw new Error('no toolbar button')
  return found
}

test('a space on a toolbar button reached by keys presses the button and pans nothing', () => {
  const button = bar()
  reached(button, true)
  const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' })
  button.dispatchEvent(down)
  flushSync()
  expect(down.defaultPrevented).toBe(false)
  expect(dragged()).toEqual({ x: 0, y: 0 })
  space('keyup', button)
})

test('a space on a toolbar button last clicked still pans', () => {
  const button = bar()
  reached(button, false)
  space('keydown', button)
  expect(dragged().x).not.toBe(0)
  space('keyup', button)
})
