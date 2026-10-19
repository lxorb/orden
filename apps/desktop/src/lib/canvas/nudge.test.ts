import { describe, expect, test, vi } from 'vitest'

/** The keys a plane answers, pressed on a plane with one card picked. The modules
 *  read the browser's storage as they load, so it is stood in for first. */
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
})

const { NoteDoc, Tab } = await import('../workspace/documents.svelte')
const { CanvasStore } = await import('./store.svelte')
const { blankCanvas, readCanvas, writeCanvas } = await import('./format')
const { run } = await import('./actions')
const { GRID } = await import('./geometry')

function picked() {
  const text = writeCanvas({
    ...readCanvas(blankCanvas()),
    nodes: [{ id: 'aa', type: 'text', x: 100, y: 40, width: 250, height: 60, text: 'aa' }],
  })
  const note = new NoteDoc(
    { kind: 'canvas', path: '/space/Board.canvas', name: 'Board.canvas', text, dirty: false },
    () => undefined,
  )
  const store = new CanvasStore(new Tab(note, 'pane'))
  store.pick('aa')
  return store
}

const view = {
  width: 800,
  height: 600,
  path: null,
  name: 'Board',
  palette: {} as never,
  onfind: () => undefined,
}

function press(key: string, shiftKey = false): KeyboardEvent {
  return {
    key,
    code: key,
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  } as KeyboardEvent
}

describe('a nudge', () => {
  test('is a pixel with a bare arrow', () => {
    const store = picked()
    expect(run.keys(store, press('ArrowRight'), view)).toBe(true)
    expect(store.canvas.nodes[0]?.x).toBe(101)
  })

  test('and a grid step with Shift, which is not in the binding', () => {
    const store = picked()
    expect(run.keys(store, press('ArrowRight', true), view)).toBe(true)
    expect(store.canvas.nodes[0]?.x).toBe(100 + GRID)
    expect(run.keys(store, press('ArrowUp', true), view)).toBe(true)
    expect(store.canvas.nodes[0]?.y).toBe(40 - GRID)
  })
})

describe('the zoom keys', () => {
  // The bar has no zoom buttons, so the keys are a keyboard's whole zoom (#401).
  const chord = (key: string, code: string) =>
    ({ key, code, ctrlKey: true, altKey: true, metaKey: false, shiftKey: false }) as KeyboardEvent

  test('go in and out about the middle of the view', () => {
    const store = picked()
    const was = store.camera.scale
    expect(run.keys(store, chord('=', 'Equal'), view)).toBe(true)
    expect(store.camera.scale).toBeGreaterThan(was)
    expect(run.keys(store, chord('-', 'Minus'), view)).toBe(true)
    expect(run.keys(store, chord('-', 'Minus'), view)).toBe(true)
    expect(store.camera.scale).toBeLessThan(was)
  })
})
