import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { clearFormatting, insertHorizontalRule, setHeading, toggleWrap } from './commands'
import { external } from './external'
import { blockDecorations } from './live-preview'
import { buildDecorations } from './live-preview/decorate'
import { modeExtensions, setReadingMode, setSourceMode } from './modes'
import { reformatDocument } from './reformat'

/** A view is a DOM thing and these tests are not, so this is everything the
 *  mode setters actually touch: a state to dispatch into, and the class list
 *  they mark for the stylesheet. */
function surface(doc: string, cursor = doc.length) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: modeExtensions(),
  })

  const classes = new Set<string>()
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
    dom: {
      classList: {
        toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
        remove: (name: string) => classes.delete(name),
      },
    },
  }

  return { view: view as unknown as EditorView, classes }
}

/** Text the reader never sees: syntax the preview has concealed. */
function concealed(state: EditorState): string[] {
  const out: string[] = []
  buildDecorations(state).atomic.between(0, state.doc.length, (from, to) => {
    out.push(state.doc.sliceString(from, to))
  })
  return out
}

/** What is drawn as a rendered block. Read off the state's own field rather
 *  than built fresh, because reaching that field is half of what turning the
 *  mode on has to do: its transaction moves neither text nor caret. */
function rendered(state: EditorState): string[] {
  const out: string[] = []
  state.field(blockDecorations).decorations.between(0, state.doc.length, (from, to) => {
    out.push(state.doc.sliceString(from, to))
  })
  return out
}

/** The document a change leaves behind, filters and all. */
function afterChange(state: EditorState, spec: TransactionSpec): string {
  return state.update(spec).state.doc.toString()
}

/** The document a command leaves behind, against a state that may refuse it. */
function afterCommand(state: EditorState, command: StateCommand): string {
  let written = state.doc.toString()
  command({ state, dispatch: (transaction) => (written = transaction.state.doc.toString()) })
  return written
}

describe('turning reading mode on', () => {
  test('takes the writing surface away from the browser', () => {
    const { view } = surface('# Note')
    expect(view.state.readOnly).toBe(false)
    expect(view.state.facet(EditorView.editable)).toBe(true)

    setReadingMode(view, true)

    expect(view.state.readOnly).toBe(true)
    expect(view.state.facet(EditorView.editable)).toBe(false)
  })

  test('marks the editor for the stylesheet', () => {
    const { view, classes } = surface('# Note')
    setReadingMode(view, true)
    expect(classes.has('nib-reading-mode')).toBe(true)

    setReadingMode(view, false)
    expect(classes.has('nib-reading-mode')).toBe(false)
  })

  test('gives everything back when it goes off', () => {
    const { view } = surface('# Note')
    setReadingMode(view, true)
    setReadingMode(view, false)

    expect(view.state.readOnly).toBe(false)
    expect(view.state.facet(EditorView.editable)).toBe(true)

    const typed = { changes: { from: 0, insert: 'A ' }, userEvent: 'input.type' }
    expect(afterChange(view.state, typed)).toBe('A # Note')
  })
})

describe('what the reader sees', () => {
  test('the syntax around the caret stays hidden', () => {
    const { view } = surface('**bold**', 4)
    expect(concealed(view.state)).toEqual([])

    setReadingMode(view, true)
    expect(concealed(view.state)).toEqual(['**', '**'])

    setReadingMode(view, false)
    expect(concealed(view.state)).toEqual([])
  })

  test('a heading keeps its hashes hidden with the caret on the line', () => {
    const { view } = surface('# Title', 3)
    expect(concealed(view.state)).toEqual([])

    setReadingMode(view, true)
    expect(concealed(view.state)).toEqual(['# '])
  })

  test('a table with the caret in it goes back to being a table', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    const { view } = surface(doc, 3)
    expect(rendered(view.state)).toEqual([])

    setReadingMode(view, true)
    expect(rendered(view.state)).toEqual([doc])

    setReadingMode(view, false)
    expect(rendered(view.state)).toEqual([])
  })
})

describe('what may still change the document', () => {
  const reading = () => {
    const { view } = surface('# Note')
    setReadingMode(view, true)
    return view.state
  }

  test('nothing anyone types', () => {
    const typed = { changes: { from: 0, insert: 'x' }, userEvent: 'input.type' }
    expect(afterChange(reading(), typed)).toBe('# Note')
  })

  test('nothing pasted, dropped or dragged out', () => {
    const state = reading()

    for (const userEvent of ['input.paste', 'input.drop', 'delete.selection']) {
      expect(afterChange(state, { changes: { from: 0, insert: 'x' }, userEvent })).toBe('# Note')
    }
    expect(afterChange(state, { changes: { from: 0, to: 6 }, userEvent: 'move.drop' })).toBe('# Note')
  })

  test('and not a widget dispatching straight at the view either', () => {
    // A checkbox, a table cell, the language on a fence: none of them carries
    // a user event, which is why the filter does not look for one.
    expect(afterChange(reading(), { changes: { from: 2, to: 6, insert: 'Read' } })).toBe('# Note')
  })

  test('a note arriving from outside still lands', () => {
    const arriving = {
      changes: { from: 0, to: 6, insert: '# Elsewhere' },
      annotations: external.of(true),
    }
    expect(afterChange(reading(), arriving)).toBe('# Elsewhere')
  })

  test('the format commands write nothing', () => {
    const state = reading()

    for (const command of [toggleWrap('**'), setHeading(2), insertHorizontalRule, clearFormatting]) {
      expect(afterCommand(state, command)).toBe('# Note')
    }
  })

  test('nor does tidying up the note', () => {
    expect(afterCommand(reading(), reformatDocument)).toBe('# Note')
  })
})

describe('source mode and reading mode', () => {
  /** Whether the live preview is up - which is what source mode takes away. */
  const preview = (state: EditorState) => state.field(blockDecorations, false) !== undefined

  test('are never both on: reading takes source off', () => {
    const { view } = surface('| a |\n| --- |\n| 1 |')
    setSourceMode(view, true)
    expect(preview(view.state)).toBe(false)

    setReadingMode(view, true)
    expect(preview(view.state)).toBe(true)
    expect(view.state.readOnly).toBe(true)
  })

  test('and source takes reading off', () => {
    const { view, classes } = surface('| a |\n| --- |\n| 1 |')
    setReadingMode(view, true)

    setSourceMode(view, true)
    expect(view.state.readOnly).toBe(false)
    expect(preview(view.state)).toBe(false)
    expect(classes.has('nib-reading-mode')).toBe(false)
  })
})
