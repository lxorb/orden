import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { findExtensions, findShown, findTally, NO_TALLY, termAt } from './find'
import { ordenBindings, standardBindings } from './keymap'

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

function asks(sent: TransactionSpec[]): number {
  return sent.filter((spec) => Array.isArray(spec.effects) || !!spec.effects).length
}

describe('the find keys before the engine is here', () => {
  test('Control+F puts the bar up, and says the press is spent', () => {
    expect(findTally(EditorState.create({ doc: 'the wind' }))).toEqual(NO_TALLY)

    const find = [...ordenBindings, ...standardBindings].find((one) => one.id === 'edit.find')
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

  test('and a key held down asks again without opening a second bar', () => {
    const find = [...ordenBindings, ...standardBindings].find((one) => one.id === 'edit.find')
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

  test('and a step with nothing to step through opens the bar rather than a panel', () => {
    const step = [...ordenBindings, ...standardBindings].find((one) => one.id === 'edit.find-next')
    expect(step?.key).toBe('Mod-g')

    const { answered, sent, state } = pressed((view) => step?.run(view) ?? false)

    expect(answered).toBe(true)
    expect(asks(sent)).toBe(1)
    expect(state.field(findShown)).toBe(true)
  })

  test('and goto-line spends the press', () => {
    const goto = [...ordenBindings, ...standardBindings].find((one) => one.id === 'edit.goto-line')
    expect(goto?.key).toBe('Mod-Alt-g')

    const { answered } = pressed((view) => goto?.run(view) ?? false)

    expect(answered).toBe(true)
  })
})
