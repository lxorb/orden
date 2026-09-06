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
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('document', { documentElement: { style: { setProperty: () => undefined } } })

/** What the two modes under test were last told. The editor's own side of
 *  them is tested in packages/editor; what matters here is that the store
 *  says the same thing to a view as it says in the menu. */
const told = vi.hoisted(() => ({ calls: [] as { mode: string; on: boolean }[] }))

vi.mock('@nib/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@nib/editor')>()),
  setReadingMode: (_view: unknown, on: boolean) => told.calls.push({ mode: 'reading', on }),
  setSourceMode: (_view: unknown, on: boolean) => told.calls.push({ mode: 'source', on }),
}))

/** Everything the other mode setters reach for on a view, and nothing else. */
function surface() {
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
        toggle: () => undefined,
        remove: () => undefined,
        add: () => undefined,
      },
    },
  }

  return view as unknown as EditorView
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
  told.calls = []
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

  test('reaches the view it is toggled against', () => {
    modes.toggleReading(surface())
    expect(told.calls).toContainEqual({ mode: 'reading', on: true })
  })

  test('is put back on a view built later', () => {
    modes.toggleReading()
    told.calls = []

    modes.apply(surface())

    expect(told.calls).toContainEqual({ mode: 'reading', on: true })
  })

  test('and stays off on one when it is off', () => {
    modes.apply(surface())
    expect(told.calls).toContainEqual({ mode: 'reading', on: false })
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
