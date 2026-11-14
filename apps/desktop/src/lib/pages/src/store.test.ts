import { beforeEach, describe, expect, test, vi } from 'vitest'

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

const { NoteDoc, Tab } = await import('../../workspace/documents.svelte')
const { PagesStore, PEEK } = await import('./store.svelte')
const { blankPages, GUTTER, pagesOf } = await import('@orden/markdown/pages')
const { readCanvas } = await import('@orden/markdown/canvas')

const A4 = { width: 794, height: 1123 }

function opened(text = blankPages(), path = '/space/Lecture.pages') {
  const note = new NoteDoc(
    { kind: 'pages', path, name: 'Lecture.pages', text, dirty: false },
    () => undefined,
  )

  const store = new PagesStore(new Tab(note, 'pane'))
  store.measured(1180, 722)
  if (!store.framed) store.fitWidth(false)
  return { store, note }
}

function ofPages(count: number, path?: string) {
  const held = opened(blankPages(), path)
  for (let at = 1; at < count; at++) held.store.addPage()
  return held
}

beforeEach(() => {
  localStorage.clear()
})

describe('a page note', () => {
  test('opens on one page, fitted across the pane', () => {
    const { store } = opened()

    expect(store.count).toBe(1)
    expect(store.camera.scale).toBeCloseTo((1180 - 56) / A4.width, 6)
  })

  test('lays its column out with a gutter between the sheets', () => {
    const { store } = ofPages(3)
    const [first, second, third] = store.pages

    expect(first?.y).toBe(0)
    expect(second?.y).toBe(A4.height + GUTTER)
    expect(third?.y).toBe(2 * (A4.height + GUTTER))
    expect(store.tall).toBe(3 * A4.height + 2 * GUTTER)
  })
})

describe('a page added', () => {
  test('goes in at the end and says which page it is', () => {
    const { store } = opened()

    expect(store.addPage()).toBe(2)
    expect(store.count).toBe(2)
    expect(store.addPage()).toBe(3)
  })

  test('takes the size and the ruling of the one it follows', () => {
    const { store } = opened(blankPages('letter'))
    store.addPage()

    const [first, second] = store.pages
    expect(second?.paper).toBe(first?.paper)
    expect(second?.pattern).toBe(first?.pattern)
  })

  test('goes in after the page named, rather than at the end', () => {
    const { store } = ofPages(3)
    const second = store.pages[1]
    if (!second) throw new Error('no second page')

    expect(store.addPage(second.id)).toBe(3)
    expect(store.count).toBe(4)
  })

  test('is taken back whole by one undo', () => {
    const { store } = opened()
    store.addPage()
    expect(store.count).toBe(2)
    expect(store.canUndo).toBe(true)

    store.undo()
    expect(store.count).toBe(1)
  })

  test('and put back again by redo', () => {
    const { store } = opened()
    store.addPage()
    store.undo()

    store.redo()
    expect(store.count).toBe(2)
  })

  test('reaches the file, so a page is a page after the note is closed', () => {
    const { store, note } = opened()
    store.addPage()
    store.part()

    expect(pagesOf(readCanvas(note.text))).toHaveLength(2)
  })

  test('and is refused outright in a space somebody shared to read', () => {
    const { store } = opened()
    store.readOnly = true

    expect(store.addPage()).toBe(0)
    expect(store.count).toBe(1)
  })
})

describe('where the next sheet would go', () => {
  test('is the box the page that is added lands in', () => {
    const { store } = ofPages(2)
    const slot = store.slot
    if (!slot) throw new Error('no slot')

    expect(store.addPage()).toBe(3)
    const made = store.pages[2]
    expect({ x: made?.x, y: made?.y, width: made?.width, height: made?.height }).toEqual(slot)
  })

  test('is nothing at all in a note nobody may write in', () => {
    const { store } = opened()
    store.readOnly = true

    expect(store.slot).toBeNull()
  })
})

describe('the view held to the column', () => {
  test('cannot be scrolled off the top', () => {
    const { store } = ofPages(3)
    store.camera = store.held({ ...store.camera, y: -10_000 })

    expect(store.top).toBeGreaterThan(-40)
    expect(store.top).toBeLessThan(0)
  })

  test('reaches a band past the last page, for the sheet that is not there yet', () => {
    const { store } = ofPages(3)
    store.camera = store.held({ ...store.camera, y: 10_000 })

    const below = store.viewBottom - store.tall
    expect(below).toBeCloseTo(GUTTER + PEEK / store.camera.scale, 6)
    expect(store.camera.y).toBeCloseTo(store.bottom, 6)
  })

  test('and stops at the paper in a note nobody may write in', () => {
    const { store } = ofPages(3)
    store.readOnly = true
    store.camera = store.held({ ...store.camera, y: 10_000 })

    expect(store.viewBottom - store.tall).toBeLessThan(GUTTER)
  })

  test('sits sideways on nought while the paper is wider than the pane', () => {
    const { store } = ofPages(2)
    store.camera = store.held({ ...store.camera, x: 400 })

    expect(store.camera.x).toBeCloseTo(0, 6)
  })
})

describe('the two fits and the zoom in between', () => {
  test('fitting the width puts the widest page across the pane', () => {
    const { store } = ofPages(2)
    store.zoomTo(1)
    store.fitAgain()

    expect(store.camera.scale).toBeCloseTo((1180 - 56) / A4.width, 6)
  })

  test('fitting the page puts the whole of it in the pane', () => {
    const { store } = ofPages(2)
    store.fitPage()

    expect(store.camera.scale).toBeCloseTo((722 - 56) / A4.height, 6)
  })

  test('and one to one is one to one', () => {
    const { store } = ofPages(2)
    store.zoomTo(1)

    expect(store.camera.scale).toBe(1)
  })

  test('zooms in far past a canvas, to 3200%, and no further', () => {
    const { store } = ofPages(2)
    for (let step = 0; step < 40; step++) store.zoomBy(1.2)
    expect(store.camera.scale).toBe(32)

    store.camera = { ...store.camera, scale: 100 }
    expect(store.camera.scale).toBe(32)
  })

  test('the paper stays fitted while nobody has chosen a zoom', () => {
    const { store } = ofPages(2)
    store.measured(800, 722)

    expect(store.camera.scale).toBeCloseTo((800 - 56) / A4.width, 6)
  })

  test('and a zoom the reader chose survives the pane being resized', () => {
    const { store } = ofPages(2)
    store.zoomTo(1)
    store.measured(800, 722)

    expect(store.camera.scale).toBe(1)
  })

  test('and survives the app being started again', () => {
    const first = ofPages(2, '/space/Kept.pages')
    first.store.zoomTo(1)
    first.store.part()

    const again = opened(first.note.text, '/space/Kept.pages')
    expect(again.store.camera.scale).toBe(1)

    again.store.measured(900, 700)
    expect(again.store.camera.scale).toBe(1)
  })

  test('and survives another tab and back, the surface made again on the same tab', () => {
    const first = ofPages(2, '/space/Switched.pages')
    first.store.zoomTo(1.6)
    const tab = (first.store as unknown as { tab: InstanceType<typeof Tab> }).tab

    const back = new PagesStore(tab)
    back.measured(1180, 722)
    back.measured(1000, 722)
    expect(back.camera.scale).toBe(1.6)
  })

  test('while a fitted one comes back fitted, and fits the new pane', () => {
    const first = ofPages(2, '/space/Fitted.pages')
    first.store.turnTo(2)
    first.store.part()

    const again = opened(first.note.text, '/space/Fitted.pages')
    again.store.measured(800, 722)

    expect(again.store.camera.scale).toBeCloseTo((800 - 56) / A4.width, 6)
  })
})

describe('turning to a page', () => {
  test('puts its top at the top of the pane', () => {
    const { store } = ofPages(4)
    store.turnTo(3)

    expect(store.showing).toBe(3)
    expect(store.top).toBeCloseTo((store.pages[2]?.y ?? 0) - 28 / store.camera.scale, 0)
  })

  test('and never past the pages there are', () => {
    const { store } = ofPages(3)
    store.turnTo(99)

    expect(store.showing).toBe(3)
  })

  test('works the same in a note of sixty pages', () => {
    const { store } = ofPages(60)
    expect(store.count).toBe(60)

    store.turnTo(60)
    expect(store.showing).toBe(60)
    expect(store.tall).toBe(60 * A4.height + 59 * GUTTER)
  })
})

describe('a glide to a page that is still going', () => {
  function frames() {
    const waiting = new Map<number, FrameRequestCallback>()
    let next = 0
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      next += 1
      waiting.set(next, run)
      return next
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      waiting.delete(id)
    })

    return () => {
      for (let round = 0; round < 100 && waiting.size; round++) {
        const due = [...waiting.entries()]
        waiting.clear()
        for (const [, run] of due) run(0)
      }
    }
  }

  test.each([
    ['a page turned to', (store: InstanceType<typeof PagesStore>) => store.turnTo(2), 2],
    ['a page fitted', (store: InstanceType<typeof PagesStore>) => store.fitPage(), 1],
    ['a zoom', (store: InstanceType<typeof PagesStore>) => store.zoomBy(1.5), 1],
  ])('gives way to %s', (_name, move, page) => {
    vi.useFakeTimers()
    const settle = frames()
    const { store } = ofPages(6)

    store.glideTo(6)
    vi.advanceTimersByTime(100)
    move(store)
    const after = store.camera
    vi.advanceTimersByTime(1000)
    settle()

    expect(store.camera).toEqual(after)
    expect(store.showing).toBe(page)
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  })
})
