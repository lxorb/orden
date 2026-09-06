import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { EditorView } from '@nib/editor'

/** The store writes to the browser's storage the moment anything is toggled,
 *  and sets the zoom on the document element. Under node there is neither, so
 *  both are stood in for before the store is imported. */
function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('document', { documentElement: { style: { setProperty: () => undefined } } })

/** Everything the mode setters reach for on a view, and nothing else: what
 *  they end up doing is dispatching, and marking the editor's element. */
function surface() {
  const classes = new Set<string>()
  const view = {
    state: { readOnly: false },
    dispatch: () => undefined,
    focus: () => undefined,
    requestMeasure: () => undefined,
    contentDOM: { setAttribute: () => undefined },
    dom: {
      isConnected: false,
      style: { setProperty: () => undefined },
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
        remove: (name: string) => classes.delete(name),
        add: (name: string) => classes.add(name),
      },
    },
  }

  return { view: view as unknown as EditorView, classes }
}

let modes: typeof import('./modes.svelte').modes

/** The store as a fresh start of the app would find it. */
async function restarted() {
  vi.resetModules()
  const store = (await import('./modes.svelte')).modes
  store.restore()
  return store
}

beforeEach(async () => {
  localStorage.clear()
  modes = await restarted()
})

describe('reading mode', () => {
  test('starts off', () => {
    expect(modes.reading).toBe(false)
  })

  test('is remembered across a restart', async () => {
    modes.toggleReading()
    expect(modes.reading).toBe(true)

    expect((await restarted()).reading).toBe(true)
  })

  test('is put back on a view built later', () => {
    modes.toggleReading()

    const { view, classes } = surface()
    modes.apply(view)

    expect(classes.has('nib-reading-mode')).toBe(true)
  })

  test('leaves nothing on the view once it is off', () => {
    const { view, classes } = surface()
    modes.apply(view)

    expect(classes.has('nib-reading-mode')).toBe(false)
  })
})

describe('reading mode and source mode', () => {
  test('are never both on', () => {
    modes.toggleSource()
    modes.toggleReading()

    expect(modes.reading).toBe(true)
    expect(modes.source).toBe(false)

    modes.toggleSource()

    expect(modes.source).toBe(true)
    expect(modes.reading).toBe(false)
  })

  test('cannot both come back from a hand-edited entry', async () => {
    localStorage.setItem('nib:modes', JSON.stringify({ source: true, reading: true }))

    const restored = await restarted()
    expect(restored.source).toBe(true)
    expect(restored.reading).toBe(false)
  })

  test('the one that was on is the one that comes back', async () => {
    modes.toggleReading()

    const restored = await restarted()
    expect(restored.reading).toBe(true)
    expect(restored.source).toBe(false)
  })
})
