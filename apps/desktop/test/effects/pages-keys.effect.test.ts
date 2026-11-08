import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { emptyPages } from '@orden/markdown/pages'
import Pages from '../../src/lib/Pages.svelte'
import { writeCanvas } from '../../src/lib/canvas/format'
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

const points = [0, 1].map((step) => ({
  x: 100 + step * 40,
  y: 100,
  pressure: 0.5,
  tiltX: 0,
  tiltY: 0,
  t: step,
}))

beforeEach(() => {
  tools.choose('select')
  const ink = [{ id: 's', tool: 'pen' as const, color: '#000000', size: 2, points }]
  const note = new NoteDoc(
    {
      kind: 'pages',
      path: '/space/Notes.pages',
      name: 'Notes.pages',
      text: writeCanvas({ ...emptyPages('a4'), ink }),
      dirty: false,
    },
    () => undefined,
  )
  tab = new Tab(note, 'pane')
  host = document.createElement('div')
  document.body.append(host)
  const shown = mount(Pages, { target: host, props: { tab, focused: true } })
  close = () => void unmount(shown)
  flushSync()
})

afterEach(() => {
  close()
  host.remove()
})

function store(): CanvasStore {
  const found = CanvasStore.drawing(tab.note, [tab])
  if (!found) throw new Error('no page note store')
  return found
}

function press(key: string, ctrlKey = false): KeyboardEvent {
  const plane = host.querySelector<HTMLElement>('.pages')
  if (!plane) throw new Error('no page note')
  const event = new KeyboardEvent('keydown', {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ctrlKey,
    bubbles: true,
    cancelable: true,
  })
  plane.dispatchEvent(event)
  flushSync()
  return event
}

test('ink deleted with the Delete key is picked no more, and an undo brings it back unpicked', () => {
  store().pickAll(['s'])
  flushSync()

  press('Delete')
  expect(store().canvas.ink).toEqual([])
  expect(store().picked).toEqual([])

  store().undo()
  flushSync()
  expect(store().canvas.ink.map((one) => one.id)).toEqual(['s'])
  expect(store().picked).toEqual([])
})

test('Ctrl+D duplicates the picked ink, rather than putting the tab down', () => {
  store().pickAll(['s'])
  flushSync()

  const event = press('d', true)
  expect(event.defaultPrevented).toBe(true)
  expect(store().canvas.ink).toHaveLength(2)
  expect(store().picked).not.toContain('s')
})

test('and with nothing picked it leaves Ctrl+D to the app', () => {
  const event = press('d', true)
  expect(event.defaultPrevented).toBe(false)
  expect(store().canvas.ink).toHaveLength(1)
})

test('Ctrl+F with the find bar up takes the caret back to its field, the word chosen', () => {
  press('f', true)
  const field = host.querySelector<HTMLInputElement>('.find input')
  if (!field) throw new Error('no find field')
  field.value = 'kestrel'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()

  const plane = host.querySelector<HTMLElement>('.pages')
  plane?.focus()
  expect(document.activeElement).toBe(plane)
  press('f', true)
  expect(document.activeElement).toBe(field)
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'kestrel'.length])
})
