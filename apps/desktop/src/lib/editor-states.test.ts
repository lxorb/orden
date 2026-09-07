import {
  editorState,
  EditorState,
  HeldState,
  SharedDoc,
  StateEffect,
  type StateView,
  type TransactionSpec,
} from '@nib/editor'
import { describe, expect, test } from 'vitest'
import { EditorStates } from './editor-states'

/** Stands in for a scroll snapshot; see held.test.ts in the editor package. */
const scrolledTo = StateEffect.define<number>({ map: (at, changes) => changes.mapPos(at) })

/** A pane's view without a DOM: the state it holds, and where it is scrolled. */
class Surface implements StateView {
  state = EditorState.create({})
  at = 0
  /** How many transactions it has been handed. A switch should cost one. */
  transactions = 0

  setState(next: EditorState) {
    this.state = next
  }

  dispatch(spec: TransactionSpec) {
    this.state = this.state.update(spec).state
    this.transactions++

    for (const effect of [spec.effects ?? []].flat()) {
      if (effect.is(scrolledTo)) this.at = effect.value
    }
  }

  scrollSnapshot() {
    return scrolledTo.of(this.at)
  }
}

/** One note the app has open: the document, and a state built on it the way the
 *  pane builds one. */
function note(text: string) {
  const shared = new SharedDoc(text)
  return { shared, state: () => editorState({ shared }) }
}

describe('the states a pane keeps', () => {
  test('builds one the first time it shows a note and keeps it after that', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = note('Alpha')
    const beta = note('Beta')

    expect(states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))).toBe(true)
    expect(states.show(view, 'b', () => HeldState.waiting(beta.shared, beta.state()))).toBe(true)
    expect(states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))).toBe(false)

    expect(states.count).toBe(2)
    expect(view.state.doc.toString()).toBe('Alpha')
  })

  test('a note switched away from and back to keeps its place', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = note('one\ntwo\nthree')
    const beta = note('Beta')

    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))
    view.at = 8
    states.show(view, 'b', () => HeldState.waiting(beta.shared, beta.state()))
    expect(view.state.doc.toString()).toBe('Beta')

    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))

    expect(view.state.doc.toString()).toBe('one\ntwo\nthree')
    expect(view.at).toBe(8)
  })

  test('a note not on show still hears every change made to it', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = note('Alpha')
    const beta = note('Beta')

    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))
    states.show(view, 'b', () => HeldState.waiting(beta.shared, beta.state()))

    // A rename rewrites the title of a note nobody is looking at.
    alpha.shared.replace('Alpha renamed')
    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))

    expect(view.state.doc.toString()).toBe('Alpha renamed')
  })

  test('a tab that closes lets its document go', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = note('Alpha')
    const beta = note('Beta')

    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))
    states.show(view, 'b', () => HeldState.waiting(beta.shared, beta.state()))
    expect(alpha.shared.panes).toBe(1)

    states.keepOnly(['b'])

    expect(states.count).toBe(1)
    expect(alpha.shared.panes).toBe(0)
  })

  test('the note on show stays even when the list forgets to mention it', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = note('Alpha')

    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))
    states.keepOnly([])

    expect(states.count).toBe(1)
    expect(states.current).toBe('a')
  })

  test('a note closed and opened again is built afresh, at the top', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = note('one\ntwo\nthree')
    const beta = note('Beta')

    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))
    view.at = 8
    states.show(view, 'b', () => HeldState.waiting(beta.shared, beta.state()))
    states.keepOnly(['b'])

    // Reopened, the tab is a new tab with a new id, so nothing of the old one is
    // in the way; where it was being read is the app's to remember.
    view.at = 0
    expect(states.show(view, 'a2', () => HeldState.waiting(alpha.shared, alpha.state()))).toBe(true)
    expect(view.at).toBe(0)
  })

  test('what a state is dressed for is remembered against its tab', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = note('Alpha')

    expect(states.fitted('a')).toBeUndefined()

    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))
    states.fit('a', 'modes and keys')

    expect(states.fitted('a')).toBe('modes and keys')

    states.keepOnly([])
    states.show(view, 'b', () => HeldState.waiting(alpha.shared, alpha.state()))
    states.keepOnly(['b'])

    // The tab has gone, so nothing is remembered about it: a tab opened later
    // with the same id would be another tab.
    expect(states.fitted('a')).toBeUndefined()
  })

  test('the note the view was built on is settled once, not on every look', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = note('one\ntwo\nthree')

    states.started('a', alpha.shared, view, scrolledTo.of(8))
    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))
    expect(view.at).toBe(8)
    expect(view.transactions).toBe(1)

    // A reader who has scrolled on since is not dragged back to where they came
    // in by an effect running again.
    view.at = 40
    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))

    expect(view.at).toBe(40)
    expect(view.transactions).toBe(1)
  })

  test('a pane that goes lets go of everything it held', () => {
    const states = new EditorStates()
    const view = new Surface()
    const alpha = note('Alpha')
    const beta = note('Beta')

    states.show(view, 'a', () => HeldState.waiting(alpha.shared, alpha.state()))
    states.show(view, 'b', () => HeldState.waiting(beta.shared, beta.state()))
    states.releaseAll(view)

    expect(states.count).toBe(0)
    expect(states.current).toBeNull()
    expect(alpha.shared.panes).toBe(0)
    expect(beta.shared.panes).toBe(0)
  })
})
