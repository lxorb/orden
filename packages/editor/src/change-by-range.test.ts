import {
  type ChangeSet,
  type ChangeSpec,
  EditorSelection,
  EditorState,
  type SelectionRange,
} from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { growth, GROWS_AT_MOST } from '../../../scripts/growth'

interface Made {
  changes: ChangeSpec
  range: SelectionRange
}

type Edit = (state: EditorState, range: SelectionRange) => Made

function oneByOne(state: EditorState, edit: Edit) {
  const results = state.selection.ranges.map((range) => edit(state, range))
  const [first, ...rest] = results
  if (!first) throw new Error('no ranges')
  let changes: ChangeSet = state.changes(first.changes)
  const ranges = [first.range]
  for (const result of rest) {
    const own = state.changes(result.changes)
    const mapped = own.map(changes)
    for (let at = 0; at < ranges.length; at++) ranges[at] = ranges[at]!.map(mapped)
    ranges.push(result.range.map(changes.mapDesc(own, true)))
    changes = changes.compose(mapped)
  }
  return { changes, selection: EditorSelection.create(ranges, state.selection.mainIndex) }
}

function random(seed: number) {
  let value = seed
  return (below: number) => {
    value = (value * 1103515245 + 12345) % 2147483648
    return value % below
  }
}

const EDITS: Record<string, Edit> = {
  typed: (_state, range) => ({
    changes: { from: range.from, to: range.to, insert: 'x' },
    range: EditorSelection.cursor(range.from + 1),
  }),
  deletedBack: (_state, range) => {
    const from = range.empty ? Math.max(0, range.from - 1) : range.from
    return { changes: { from, to: range.to }, range: EditorSelection.cursor(from) }
  },
  newLine: (state, range) => {
    const indent = /^\s*/.exec(state.doc.lineAt(range.head).text)?.[0] ?? ''
    const insert = `\n${indent}`
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    }
  },
  lineStart: (state, range) => {
    const line = state.doc.lineAt(range.head)
    return {
      changes: { from: line.from, insert: '- ' },
      range: EditorSelection.range(range.anchor + 2, range.head + 2),
    }
  },
  wrapped: (_state, range) => ({
    changes: [
      { from: range.from, insert: '**' },
      { from: range.to, insert: '**' },
    ],
    range: EditorSelection.range(range.from + 2, range.to + 2),
  }),
  untouched: (_state, range) => ({ changes: [], range }),
  movedOnly: (state, range) => ({
    changes: [],
    range: EditorSelection.cursor(Math.min(state.doc.length, range.head + 3)),
  }),
  sideways: (state, range) => ({
    changes: { from: Math.max(0, range.from - 3), to: Math.min(state.doc.length, range.to + 3) },
    range: EditorSelection.cursor(Math.max(0, range.from - 3)),
  }),
}

function stateWith(seed: number, count: number): EditorState {
  const pick = random(seed)
  const doc = Array.from({ length: 40 + pick(80) }, () =>
    ' '.repeat(pick(4)).concat('abc def ghi'.slice(0, 1 + pick(11))),
  ).join('\n')
  const ranges = Array.from({ length: count }, () => {
    const at = pick(doc.length + 1)
    return pick(3) === 0
      ? EditorSelection.range(at, Math.min(doc.length, at + pick(5)))
      : EditorSelection.cursor(at)
  })
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges, pick(ranges.length)),
    extensions: EditorState.allowMultipleSelections.of(true),
  })
}

describe('a change at many carets at once', () => {
  for (const [name, edit] of Object.entries(EDITS)) {
    test(`${name}: lands as it would, change by change`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const state = stateWith(seed, 32 + (seed % 70))
        const expected = oneByOne(state, edit)
        const made = state.changeByRange((range) => edit(state, range))
        const changes = state.changes(made.changes)

        expect(changes.apply(state.doc).toString()).toBe(
          expected.changes.apply(state.doc).toString(),
        )
        expect(made.selection.eq(expected.selection, true)).toBe(true)
        for (let pos = 0; pos <= state.doc.length; pos++) {
          expect(changes.mapPos(pos, -1)).toBe(expected.changes.mapPos(pos, -1))
          expect(changes.mapPos(pos, 1)).toBe(expected.changes.mapPos(pos, 1))
        }
      }
    })
  }

  test('typed at thousands of carets takes time that grows with their number', () => {
    const states = new Map<number, EditorState>()
    const typed = (count: number) => {
      let state = states.get(count)
      if (!state) {
        const doc = Array.from({ length: count }, (_, at) => `line ${at}`).join('\n')
        const base = EditorState.create({
          doc,
          extensions: EditorState.allowMultipleSelections.of(true),
        })
        const ends = Array.from({ length: count }, (_, at) =>
          EditorSelection.cursor(base.doc.line(at + 1).to),
        )
        state = base.update({ selection: EditorSelection.create(ends) }).state
        states.set(count, state)
      }
      const now = state
      return now.changeByRange((range) => EDITS.typed!(now, range))
    }

    expect(growth(typed, 1000)).toBeLessThan(GROWS_AT_MOST)
  })
})
