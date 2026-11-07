import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { blankPages } from '@orden/markdown/pages'
import CanvasBar from '../../src/lib/CanvasBar.svelte'
import { blankCanvas, type CanvasNode, readCanvas, writeCanvas } from '../../src/lib/canvas/format'
import { CanvasStore } from '../../src/lib/canvas/store.svelte'
import { PagesStore } from '../../src/lib/pages/store.svelte'
import { NoteDoc, Tab } from '../../src/lib/workspace/documents.svelte'

function card(id: string): CanvasNode {
  return { id, type: 'text', x: 0, y: 0, width: 250, height: 60, text: id }
}

const SURFACES = [
  {
    surface: 'canvas',
    kind: 'canvas',
    name: 'Board.canvas',
    blank: blankCanvas,
    Store: CanvasStore,
  },
  {
    surface: 'page note',
    kind: 'pages',
    name: 'Lecture.pages',
    blank: () => blankPages(),
    Store: PagesStore,
  },
] as const

describe.each(SURFACES)('on a $surface', ({ kind, name, blank, Store }) => {
  let host: HTMLElement
  let shown: ReturnType<typeof mount>
  let store: CanvasStore
  let note: NoteDoc

  beforeEach(() => {
    note = new NoteDoc(
      { kind, path: `/space/${name}`, name, text: blank(), dirty: false },
      () => undefined,
    )
    store = new Store(new Tab(note, 'pane'))

    host = document.createElement('div')
    document.body.append(host)
    const held = store
    shown = mount(CanvasBar, {
      target: host,
      props: {
        get canundo() {
          return held.canUndo
        },
        get canredo() {
          return held.canRedo
        },
        zoom: 1,
        onundo: () => held.undo(),
        onredo: () => held.redo(),
        onerase: () => undefined,
        onzoom: () => undefined,
        onfit: () => undefined,
      },
    })
    flushSync()
  })

  afterEach(() => {
    void unmount(shown)
    host.remove()
  })

  function lit(label: 'Undo' | 'Redo'): boolean {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    if (!button) throw new Error(`no ${label} on the bar`)
    return !button.disabled
  }

  function put(id: string) {
    store.edit({ ...store.canvas, nodes: [...store.canvas.nodes, card(id)] })
  }

  test('nothing drawn is nothing to take back', () => {
    expect(lit('Undo')).toBe(false)
    expect(lit('Redo')).toBe(false)
  })

  test('an edit lights Undo', () => {
    put('a')
    flushSync()

    expect(lit('Undo')).toBe(true)
    expect(lit('Redo')).toBe(false)
  })

  test('taking it back lights Redo and puts Undo out, and putting it forward turns them round', () => {
    put('a')
    flushSync()

    store.undo()
    flushSync()
    expect(lit('Undo')).toBe(false)
    expect(lit('Redo')).toBe(true)

    store.redo()
    flushSync()
    expect(lit('Undo')).toBe(true)
    expect(lit('Redo')).toBe(false)
  })

  test('a new edit after an undo puts Redo out', () => {
    put('a')
    store.undo()
    flushSync()
    expect(lit('Redo')).toBe(true)

    put('b')
    flushSync()
    expect(lit('Undo')).toBe(true)
    expect(lit('Redo')).toBe(false)
  })

  test('words that changed under the plane put both out', () => {
    put('a')
    put('b')
    store.undo()
    flushSync()
    expect(lit('Undo')).toBe(true)
    expect(lit('Redo')).toBe(true)

    const outside = readCanvas(blank())
    note.replace(writeCanvas({ ...outside, nodes: [...outside.nodes, card('z')] }))
    store.follow()
    flushSync()
    expect(lit('Undo')).toBe(false)
    expect(lit('Redo')).toBe(false)
  })
})
