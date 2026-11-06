import { flushSync, untrack } from 'svelte'
import { expect, test } from 'vitest'
import {
  documentOf,
  editorState,
  EditorState,
  HeldState,
  SharedDoc,
  StateEffect,
  type StateView,
  type TransactionSpec,
} from '@orden/editor'
import { EditorStates, type NoteTab } from '../../src/lib/editor-states'
import { computed, reactive, root, watch } from './runes.svelte'

const scrolledTo = StateEffect.define<number>({ map: (at, changes) => changes.mapPos(at) })

class Surface implements StateView {
  state = EditorState.create({})
  at = 0
  readonly scrollDOM = { scrollTop: 0 }

  setState(next: EditorState) {
    this.state = next
  }

  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
    for (const effect of [spec.effects ?? []].flat()) {
      if (effect.is(scrolledTo)) this.at = effect.value
    }
  }

  scrollSnapshot() {
    return scrolledTo.of(this.at)
  }
}

function tab(text: string): NoteTab & { adopt(next: string): void } {
  const note = reactive({ live: new SharedDoc(text), arrivals: 0 })
  return {
    note,
    adopt(next: string) {
      note.arrivals++
      note.live.takeOn(next)
    },
  }
}

let built = 0
let switches = 0

function editor(props: { tab: () => NoteTab; kept: () => NoteTab[] }) {
  const states = new EditorStates()
  const box = reactive<{ view: Surface | undefined }>({ view: undefined })

  watch(() => {
    const first = untrack(() => props.tab())
    const created = new Surface()
    created.setState(editorState({ shared: first.note.live }))
    first.note.live.join(created)
    built++

    states.started(first, created, null)
    box.view = created

    return () => {
      states.releaseAll(created)
      box.view = undefined
    }
  })

  watch(() => {
    const view = box.view
    const showing = props.tab()
    if (!view) return

    if (!states.shows(showing)) switches++

    untrack(() => {
      states.show(view, showing, () =>
        HeldState.waiting(showing.note.live, editorState({ shared: showing.note.live })),
      )
    })
  })

  watch(() => {
    const view = box.view
    if (view) states.keepOnly(props.kept())
  })

  return { view: () => box.view, states }
}

interface World {
  readonly tabs: NoteTab[]
  readonly websites: Set<NoteTab>
  active: number
}

function window(tabs: NoteTab[], active: number, websites: NoteTab[] = []): World {
  const at = reactive({ active })
  return {
    tabs,
    websites: new Set(websites),
    get active() {
      return at.active
    },
    set active(to: number) {
      at.active = to
    },
  }
}

function pane(world: World) {
  const showing = computed(() => world.tabs[world.active] ?? null)
  const writing = computed(() => {
    const one = showing()
    return one !== null && !world.websites.has(one)
  })

  const box = reactive<{ editor: ReturnType<typeof editor> | null }>({ editor: null })
  watch(() => {
    if (!writing()) {
      box.editor = null
      return
    }

    untrack(() => {
      box.editor = editor({ tab: () => showing()!, kept: () => world.tabs })
    })
  })

  return { view: () => box.editor?.view() ?? undefined, showing }
}

test('the pane builds its editor once, whatever the notes in it do', () => {
  const preview = tab('First')
  const kept = tab('Kept')
  const world = window([preview, kept], 0)

  built = 0
  switches = 0
  const seen: { view: Surface | undefined } = { view: undefined }
  const stop = root(() => {
    const it = pane(world)
    watch(() => {
      seen.view = it.view()
    })
  })

  flushSync()
  expect(built).toBe(1)

  world.active = 1
  flushSync()
  world.active = 0
  flushSync()
  preview.adopt('Second')
  flushSync()
  preview.adopt('Third')
  flushSync()

  expect(built).toBe(1)
  expect(switches).toBe(4)
  expect(seen.view?.state.doc.toString()).toBe('Third')
  stop()
})

test('the note in the pane is the note its tab names, switch after switch', () => {
  const note = tab('# The note')
  const site = tab('[InternetShortcut]\nURL=https://a.example\n')
  const world = window([note, site], 0, [site])

  const seen: { view: Surface | undefined } = { view: undefined }
  const stop = root(() => {
    const it = pane(world)
    watch(() => {
      seen.view = it.view()
    })
  })

  const holds = (one: NoteTab) => {
    const view = seen.view
    expect(view).toBeDefined()
    expect(documentOf(view!)).toBe(one.note.live)
    expect(view!.state.doc.toString()).toBe(one.note.live.text.toString())
  }

  flushSync()
  holds(note)

  world.active = 1
  flushSync()
  expect(seen.view).toBeUndefined()

  world.active = 0
  flushSync()
  holds(note)

  site.note.live.replace('[InternetShortcut]\nURL=https://b.example\n', false)
  flushSync()
  holds(note)
  expect(seen.view?.state.doc.toString()).toBe('# The note')

  stop()
})

test('a click in the file list moves the preview on without disturbing the others', () => {
  const preview = tab('First')
  const kept = tab('Kept')
  const world = window([preview, kept], 1)

  const seen: { view: Surface | undefined } = { view: undefined }
  const stop = root(() => {
    const it = pane(world)
    watch(() => {
      seen.view = it.view()
    })
  })

  flushSync()
  expect(seen.view?.state.doc.toString()).toBe('Kept')

  preview.adopt('Second')
  flushSync()

  expect(documentOf(seen.view!)).toBe(kept.note.live)
  expect(seen.view?.state.doc.toString()).toBe('Kept')

  world.active = 0
  flushSync()
  expect(documentOf(seen.view!)).toBe(preview.note.live)
  expect(seen.view?.state.doc.toString()).toBe('Second')

  stop()
})
