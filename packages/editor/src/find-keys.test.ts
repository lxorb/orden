import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { findExtensions, findShown, findTally, NO_TALLY, termAt } from './find'
import { nibBindings, standardBindings } from './keymap'

/** What the find keys do before the search engine is here.
 *
 *  The engine is fifteen kilobytes that a window has no use for until somebody looks
 *  for something, so it is fetched at the launch's last turn rather than carried into
 *  the first paint; see find.ts. The keys are bound from the first frame either way,
 *  and that is what this file is about: a Control+F in front of the fetch has to put the
 *  bar up, once, and a key held down must not put up two.
 *
 *  This file is deliberately its own: the engine is fetched once per process and kept,
 *  so a test that needs it absent cannot share a file with one that needs it here. Its
 *  counterpart is find.test.ts, which awaits it. */

/** Every transaction a command dispatched, which is the whole of what a command can do
 *  to a document. Enough of a view for a `Command`: nothing here draws. */
function pressed(run: (view: EditorView) => boolean, doc = 'the wind, and the wind') {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(4, 8),
    extensions: [findExtensions()],
  })
  const sent: TransactionSpec[] = []

  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      sent.push(spec)
      state = state.update(spec).state
    },
  } as unknown as EditorView

  const answered = run(view)

  return {
    answered,
    sent,
    get state() {
      return state
    },
  }
}

/** How many asks a transaction spec carries. One per press is right; the count is what
 *  says a key is not bound twice. */
function asks(sent: TransactionSpec[]): number {
  return sent.filter((spec) => Array.isArray(spec.effects) || !!spec.effects).length
}

describe('the find keys before the engine is here', () => {
  test('Control+F puts the bar up, and says the press is spent', () => {
    // That the engine is not here is the whole premise of this file, so it is asserted
    // rather than assumed: a tally is nothing at all until there is something to count
    // with, and a warm engine would answer about the document instead.
    expect(findTally(EditorState.create({ doc: 'the wind' }))).toEqual(NO_TALLY)

    const find = [...nibBindings, ...standardBindings].find((one) => one.id === 'edit.find')
    expect(find?.key).toBe('Mod-f')

    const { answered, sent, state } = pressed((view) => find?.run(view) ?? false)

    expect(answered).toBe(true)
    expect(asks(sent)).toBe(1)
    expect(state.field(findShown)).toBe(true)
  })

  test('and opens it on the word the caret was on, which needs no engine', () => {
    const state = EditorState.create({
      doc: 'the wind, and the wind',
      selection: EditorSelection.single(4, 8),
      extensions: [findExtensions()],
    })

    expect(termAt(state)).toBe('wind')
  })

  /** A key held down repeats, and every repeat is another press of the same key. What
   *  it must not be is another bar: the ask is an effect on the document and the field
   *  below is one field, so the app is told the same thing twice and has one bar to
   *  show for it. A second bar would mean a second binding on the chord, which is what
   *  shortcuts.test.ts counts. */
  test('and a key held down asks again without opening a second bar', () => {
    const find = [...nibBindings, ...standardBindings].find((one) => one.id === 'edit.find')
    let state = EditorState.create({
      doc: 'the wind, and the wind',
      extensions: [findExtensions()],
    })
    let count = 0

    const view = {
      get state() {
        return state
      },
      dispatch: (spec: TransactionSpec) => {
        count += 1
        state = state.update(spec).state
      },
    } as unknown as EditorView

    expect(find?.run(view)).toBe(true)
    expect(find?.run(view)).toBe(true)
    expect(find?.run(view)).toBe(true)

    expect(count).toBe(3)
    expect(state.field(findShown)).toBe(true)
  })

  /** The step keys fall back to opening the bar rather than the library's own panel -
   *  which is the behaviour find.ts was written for, and is also the honest answer
   *  while the engine is on its way: nothing can have been looked for yet. */
  test('and a step with nothing to step through opens the bar rather than a panel', () => {
    const step = [...nibBindings, ...standardBindings].find((one) => one.id === 'edit.find-next')
    expect(step?.key).toBe('Mod-g')

    const { answered, sent, state } = pressed((view) => step?.run(view) ?? false)

    expect(answered).toBe(true)
    expect(asks(sent)).toBe(1)
    expect(state.field(findShown)).toBe(true)
  })

  /** And the one command that is still the library's own: the press is spent on it
   *  whether or not the engine is here, because a key that answered false would fall
   *  through to whatever is bound under it. */
  test('and goto-line spends the press', () => {
    const goto = [...nibBindings, ...standardBindings].find((one) => one.id === 'edit.goto-line')
    expect(goto?.key).toBe('Mod-Alt-g')

    const { answered } = pressed((view) => goto?.run(view) ?? false)

    expect(answered).toBe(true)
  })
})
