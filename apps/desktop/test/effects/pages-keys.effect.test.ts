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

test('a page note finds only what it draws: a label on a link between its cards is not listed', () => {
  const page = store().canvas.nodes[0]
  if (!page) throw new Error('no page')
  const card = (id: string, y: number) => ({
    id,
    type: 'text' as const,
    x: 0,
    y,
    width: 200,
    height: 60,
    text: `kestrel ${id}`,
  })
  store().edit({
    ...store().canvas,
    nodes: [page, card('one', 100), card('two', 300)],
    edges: [{ id: 'link', fromNode: 'one', toNode: 'two', label: 'kestrel link' }],
  })
  flushSync()

  press('f', true)
  const field = host.querySelector<HTMLInputElement>('.find input')
  if (!field) throw new Error('no find field')
  field.value = 'kestrel'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()

  const rows = [...host.querySelectorAll('.hits button')].map((row) => row.textContent.trim())
  expect(rows).toEqual(['kestrel one', 'kestrel two'])
  expect(host.querySelector('.find .count')?.textContent).toBe('1/2')
})

test('Escape lets go of words chosen on a PDF page', () => {
  const plane = host.querySelector<HTMLElement>('.pages')
  if (!plane) throw new Error('no page note')
  const words = document.createElement('div')
  words.className = 'words live'
  words.textContent = 'kestrel over the hill'
  plane.append(words)
  const said = words.firstChild
  if (!said) throw new Error('no words')
  getSelection()?.setBaseAndExtent(said, 0, said, 'kestrel over the hill'.length)
  expect(getSelection()?.toString()).toBe('kestrel over the hill')

  press('Escape')
  expect(getSelection()?.isCollapsed ?? true).toBe(true)
  words.remove()
})

function pointer(type: string, id: number, kind: string, x: number, y: number, buttons: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons })
  Object.defineProperties(event, {
    pointerType: { value: kind },
    pointerId: { value: id },
    pressure: { value: buttons ? 0.5 : 0 },
    tiltX: { value: 0 },
    tiltY: { value: 0 },
  })
  host.querySelector('.pages')?.dispatchEvent(event)
  flushSync()
}

test('what a finger rubbed out comes back when the system cancels the touch as a palm', () => {
  tools.choose('draw')
  pointer('pointerdown', 2, 'mouse', 100, 250, 1)
  for (let x = 110; x <= 200; x += 10) pointer('pointermove', 2, 'mouse', x, 250, 1)
  pointer('pointerup', 2, 'mouse', 200, 250, 0)
  const drawn = () => JSON.stringify(store().canvas.ink.filter((stroke) => stroke.id !== 's'))
  const before = drawn()

  tools.choose('erase')
  pointer('pointerdown', 5, 'touch', 150, 240, 1)
  for (let y = 244; y <= 260; y += 4) pointer('pointermove', 5, 'touch', 150, y, 1)
  expect(drawn()).not.toBe(before)
  pointer('pointercancel', 5, 'touch', 150, 260, 0)

  expect(drawn()).toBe(before)
})

test('a pen stroke the browser cancels while the pen tip still writes goes on, as on a canvas', () => {
  tools.choose('draw')
  pointer('pointerdown', 3, 'pen', 100, 320, 1)
  for (let x = 110; x <= 150; x += 10) pointer('pointermove', 3, 'pen', x, 320, 1)
  pointer('pointercancel', 3, 'pen', 150, 320, 0)
  for (let x = 160; x <= 220; x += 10) pointer('pointermove', 3, 'pen', x, 320, 1)
  pointer('pointerup', 3, 'pen', 220, 320, 0)

  const drawn = store().canvas.ink.filter((stroke) => stroke.id !== 's')
  expect(drawn).toHaveLength(1)
  const xs = drawn[0]?.points.map((point) => point.x) ?? []
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(70)
})

test('a pen stroke the browser cancels ends once the pen tip says nothing more', async () => {
  tools.choose('draw')
  pointer('pointerdown', 4, 'pen', 100, 360, 1)
  for (let x = 110; x <= 150; x += 10) pointer('pointermove', 4, 'pen', x, 360, 1)
  pointer('pointercancel', 4, 'pen', 150, 360, 0)
  await new Promise((done) => setTimeout(done, 400))
  pointer('pointermove', 4, 'pen', 200, 360, 1)
  pointer('pointerup', 4, 'pen', 200, 360, 0)

  expect(store().canvas.ink.filter((stroke) => stroke.id !== 's')).toHaveLength(0)
})

test('a pen put down again after a cancelled stroke draws, rather than waiting on the old one', () => {
  tools.choose('draw')
  pointer('pointerdown', 7, 'pen', 100, 440, 1)
  for (let x = 110; x <= 150; x += 10) pointer('pointermove', 7, 'pen', x, 440, 1)
  pointer('pointercancel', 7, 'pen', 150, 440, 0)
  pointer('pointerdown', 8, 'pen', 100, 480, 1)
  for (let x = 110; x <= 200; x += 10) pointer('pointermove', 8, 'pen', x, 480, 1)
  pointer('pointerup', 8, 'pen', 200, 480, 0)

  const drawn = store().canvas.ink.filter((stroke) => stroke.id !== 's')
  expect(drawn).toHaveLength(1)
  const xs = drawn[0]?.points.map((point) => point.x) ?? []
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(50)
})

test('the pen’s button pressed mid-line turns the line into rubbing out, as on a canvas', () => {
  tools.choose('draw')
  pointer('pointerdown', 6, 'pen', 100, 400, 1)
  for (let x = 110; x <= 150; x += 10) pointer('pointermove', 6, 'pen', x, 400, 1)
  for (let x = 160; x <= 200; x += 10) pointer('pointermove', 6, 'pen', x, 400, 33)
  pointer('pointerup', 6, 'pen', 200, 400, 0)

  expect(store().canvas.ink.filter((stroke) => stroke.id !== 's')).toHaveLength(0)
})

test('a pen put down while a palm already rests on the page draws, as on a canvas', () => {
  tools.choose('draw')
  pointer('pointerdown', 9, 'touch', 60, 300, 1)
  pointer('pointermove', 9, 'touch', 64, 304, 1)
  pointer('pointerdown', 1, 'pen', 100, 200, 1)
  for (let x = 110; x <= 200; x += 10) pointer('pointermove', 1, 'pen', x, 200, 1)
  pointer('pointerup', 1, 'pen', 200, 200, 0)
  pointer('pointerup', 9, 'touch', 64, 304, 0)

  const drawn = store().canvas.ink.filter((stroke) => stroke.id !== 's')
  expect(drawn).toHaveLength(1)
  const xs = drawn[0]?.points.map((point) => point.x) ?? []
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(50)
})
