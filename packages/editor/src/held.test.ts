import { history } from '@codemirror/commands'
import { EditorSelection, EditorState, StateEffect, type TransactionSpec } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { HeldState, type StateView } from './held'
import { documentOf, SharedDoc, sharedOf, sharing } from './shared'

const scrolledTo = StateEffect.define<number>({ map: (at, changes) => changes.mapPos(at) })

class Surface implements StateView {
  state: EditorState
  readonly done: string[] = []
  at = 0
  readonly scrollDOM = { scrollTop: 0 }

  constructor(doc: string) {
    this.state = EditorState.create({ doc, extensions: [history(), sharing()] })
  }

  setState(next: EditorState) {
    this.state = next
    this.done.push('state')
  }

  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
    this.done.push('dispatch')

    for (const effect of [spec.effects ?? []].flat()) {
      if (effect.is(scrolledTo)) this.at = effect.value
    }
  }

  scrollSnapshot() {
    return scrolledTo.of(this.at)
  }
}

function stateFor(doc: string, cursor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(Math.min(cursor, doc.length)),
    extensions: [history(), sharing()],
  })
}

describe('a note waiting its turn', () => {
  test('takes every change made to the words while it waits', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))

    note.replace('Hello there')

    expect(held.state.doc.toString()).toBe('Hello there')
  })

  test('keeps its caret where the words moved it to', () => {
    const note = new SharedDoc('one\ntwo')
    const held = HeldState.waiting(note, stateFor('one\ntwo', 4))

    note.edit([{ from: 0, to: 0, insert: 'zero\n' }])

    expect(held.state.selection.main.head).toBe(9)
    expect(held.state.doc.lineAt(9).text).toBe('two')
  })

  test('carries its place along with the words above it', () => {
    const note = new SharedDoc('one\ntwo\nthree')
    const held = HeldState.waiting(note, stateFor('one\ntwo\nthree'), scrolledTo.of(8))

    note.edit([{ from: 0, to: 0, insert: 'zero\n' }])

    const shown = new Surface('')
    held.give(shown)

    expect(shown.at).toBe(13)
  })

  test('lets the document go when its tab closes', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))
    expect(note.panes).toBe(1)

    held.release()

    expect(note.panes).toBe(0)
  })
})

describe('showing a note in a view', () => {
  test('puts the state in and the place on, and nothing in between', () => {
    const note = new SharedDoc('one\ntwo\nthree')
    const held = HeldState.waiting(note, stateFor('one\ntwo\nthree', 4), scrolledTo.of(4))
    const view = new Surface('something else')

    held.give(view)

    expect(view.done).toEqual(['state', 'dispatch'])
    expect(view.state.doc.toString()).toBe('one\ntwo\nthree')
    expect(view.state.selection.main.head).toBe(4)
    expect(view.at).toBe(4)
  })

  test('hands the document over to the view', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))
    const view = new Surface('')

    held.give(view)
    note.replace('Hello there')

    expect(view.state.doc.toString()).toBe('Hello there')
    expect(note.panes).toBe(1)
  })

  test('says whose document the view is now holding', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))
    const view = new Surface('')

    held.give(view)

    expect(sharedOf(view.state)).toBe(note)
  })

  test('takes it back with wherever the reader had got to', () => {
    const note = new SharedDoc('one\ntwo\nthree')
    const held = HeldState.waiting(note, stateFor('one\ntwo\nthree'))
    const view = new Surface('')

    held.give(view)
    view.at = 8
    held.take(view)

    const other = new Surface('')
    held.give(other)

    expect(other.at).toBe(8)
  })

  test('goes back on a view without a word of the note being written again', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))
    const view = new Surface('')

    held.give(view)
    held.take(view)
    view.done.length = 0
    held.give(view)

    expect(view.done).toEqual(['state', 'dispatch'])
  })

  test('a note nobody has read shows at its top, with no transaction at all', () => {
    const note = new SharedDoc('Hello')
    const held = HeldState.waiting(note, stateFor('Hello'))
    const view = new Surface('')
    view.scrollDOM.scrollTop = 1200

    held.give(view)

    expect(view.done).toEqual(['state'])
    expect(view.scrollDOM.scrollTop).toBe(0)
  })

  test('a note that was being read is not dragged to its top', () => {
    const note = new SharedDoc('one\ntwo\nthree')
    const held = HeldState.waiting(note, stateFor('one\ntwo\nthree'), scrolledTo.of(8))
    const view = new Surface('')
    view.scrollDOM.scrollTop = 1200

    held.give(view)

    expect(view.scrollDOM.scrollTop).toBe(1200)
    expect(view.at).toBe(8)
  })
})

describe('a view moving from one note to another', () => {
  test('is on the note it moved to and on nothing else', () => {
    const here = new SharedDoc('the note')
    const there = new SharedDoc('[InternetShortcut]\nURL=https://a.example\n')
    const view = new Surface('')

    HeldState.waiting(here, stateFor('the note')).give(view)
    HeldState.waiting(there, stateFor('[InternetShortcut]\nURL=https://a.example\n')).give(view)

    expect(documentOf(view)).toBe(there)
    expect(here.panes).toBe(0)
  })

  test('never hears from the note it came from again', () => {
    const here = new SharedDoc('the note')
    const there = new SharedDoc('[InternetShortcut]\nURL=https://a.example\n')
    const view = new Surface('')

    HeldState.waiting(here, stateFor('the note')).give(view)
    HeldState.waiting(there, stateFor('[InternetShortcut]\nURL=https://a.example\n')).give(view)

    there.replace('[InternetShortcut]\nURL=https://b.example\n')
    here.replace('the note, changed')

    expect(view.state.doc.toString()).toBe('[InternetShortcut]\nURL=https://b.example\n')
  })

  test('costs the swap and one transaction, however many notes it has been on', () => {
    const here = new SharedDoc('one\ntwo\nthree')
    const there = new SharedDoc('four\nfive')
    const view = new Surface('')

    const first = HeldState.waiting(here, stateFor('one\ntwo\nthree'), scrolledTo.of(4))
    const second = HeldState.waiting(there, stateFor('four\nfive'), scrolledTo.of(5))

    first.give(view)
    first.take(view)
    view.done.length = 0
    second.give(view)

    expect(view.done).toEqual(['state', 'dispatch'])
    expect(view.state.doc.toString()).toBe('four\nfive')
  })

  test('hands the note back to the state waiting, and the view to the next note', () => {
    const here = new SharedDoc('one\ntwo\nthree')
    const there = new SharedDoc('four')
    const view = new Surface('')

    const first = HeldState.waiting(here, stateFor('one\ntwo\nthree'))
    first.give(view)
    view.at = 8
    first.take(view)

    expect(documentOf(first)).toBe(here)
    expect(documentOf(view)).toBeNull()

    HeldState.waiting(there, stateFor('four')).give(view)
    here.replace('one\ntwo\nthree\nfour')

    expect(view.state.doc.toString()).toBe('four')
    expect(first.state.doc.toString()).toBe('one\ntwo\nthree\nfour')
  })
})
