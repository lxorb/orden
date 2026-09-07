import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { describe, expect, test } from 'vitest'
import { clearFormatting, insertHorizontalRule, setHeading, toggleWrap } from './commands'
import { external } from './external'
import { blockDecorations } from './live-preview'
import { buildDecorations } from './live-preview/decorate'
import {
  modeEffects,
  type ModeSettings,
  modeExtensions,
  setCodeLineNumbers,
  setEquationNumbers,
  setFocusMode,
  setHeadingNumbers,
  setLigatures,
  setReadOnlyMode,
  setRightToLeft,
  setSourceMode,
  setTypewriterMode,
} from './modes'
import { reformatDocument } from './reformat'
import { parsed } from '../test/parsed'

/** A view is a DOM thing and these tests are not, so this is all the setters
 *  under test actually touch: a state to dispatch into. */
function surface(doc: string, cursor = doc.length) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: modeExtensions(),
  })

  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
  }

  return { view: view as unknown as EditorView }
}

/** The class the stylesheet works from, as the editor itself will write it
 *  onto its element - not put there by hand; see readOnlyExtensions. */
function readOnlyClass(state: EditorState): boolean {
  return state
    .facet(EditorView.editorAttributes)
    .some((attrs) => typeof attrs === 'object' && attrs.class === 'nib-read-only')
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

describe('turning read-only mode on', () => {
  test('takes the writing surface away from the browser', () => {
    const { view } = surface('# Note')
    expect(view.state.readOnly).toBe(false)
    expect(view.state.facet(EditorView.editable)).toBe(true)

    setReadOnlyMode(view, true)

    expect(view.state.readOnly).toBe(true)
    expect(view.state.facet(EditorView.editable)).toBe(false)
  })

  test('marks the editor for the stylesheet', () => {
    const { view } = surface('# Note')
    setReadOnlyMode(view, true)
    expect(readOnlyClass(view.state)).toBe(true)

    setReadOnlyMode(view, false)
    expect(readOnlyClass(view.state)).toBe(false)
  })

  test('gives everything back when it goes off', () => {
    const { view } = surface('# Note')
    setReadOnlyMode(view, true)
    setReadOnlyMode(view, false)

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

    setReadOnlyMode(view, true)
    expect(concealed(view.state)).toEqual(['**', '**'])

    setReadOnlyMode(view, false)
    expect(concealed(view.state)).toEqual([])
  })

  test('a heading keeps its hashes hidden with the caret on the line', () => {
    const { view } = surface('# Title', 3)
    expect(concealed(view.state)).toEqual([])

    setReadOnlyMode(view, true)
    expect(concealed(view.state)).toEqual(['# '])
  })

  test('turning equation numbers on takes effect at once', () => {
    // The transaction moves neither the document nor the caret, so the block
    // field has to be told that what it draws has changed. Without that the
    // setting did nothing until the next edit or click.
    const { view } = surface('$$\nx = 1\n$$\n\ntail\n')
    const before = view.state.field(blockDecorations)

    setEquationNumbers(view, true)
    expect(view.state.field(blockDecorations)).not.toBe(before)

    const numbered = view.state.field(blockDecorations)
    setEquationNumbers(view, false)
    expect(view.state.field(blockDecorations)).not.toBe(numbered)
  })

  test('a table with the caret in it goes back to being a table', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |'
    const { view } = surface(doc)

    // Moved in rather than started there: a state is built with nothing revealed,
    // because the caret it opens with is nobody's decision. See blocks.ts.
    view.dispatch({ selection: { anchor: 3 } })
    expect(rendered(view.state)).toEqual([])

    setReadOnlyMode(view, true)
    expect(rendered(view.state)).toEqual([doc])

    setReadOnlyMode(view, false)
    expect(rendered(view.state)).toEqual([])
  })
})

describe('what may still change the document', () => {
  const locked = () => {
    const { view } = surface('# Note')
    setReadOnlyMode(view, true)
    return view.state
  }

  test('nothing anyone types', () => {
    const typed = { changes: { from: 0, insert: 'x' }, userEvent: 'input.type' }
    expect(afterChange(locked(), typed)).toBe('# Note')
  })

  test('nothing pasted, dropped or dragged out', () => {
    const state = locked()

    for (const userEvent of ['input.paste', 'input.drop', 'delete.selection']) {
      expect(afterChange(state, { changes: { from: 0, insert: 'x' }, userEvent })).toBe('# Note')
    }
    expect(afterChange(state, { changes: { from: 0, to: 6 }, userEvent: 'move.drop' })).toBe(
      '# Note',
    )
  })

  test('and not a widget dispatching straight at the view either', () => {
    // A checkbox, a table cell, the language on a fence: none of them carries
    // a user event, which is why the filter does not look for one.
    expect(afterChange(locked(), { changes: { from: 2, to: 6, insert: 'Read' } })).toBe('# Note')
  })

  test('a note arriving from outside still lands', () => {
    const arriving = {
      changes: { from: 0, to: 6, insert: '# Elsewhere' },
      annotations: external.of(true),
    }
    expect(afterChange(locked(), arriving)).toBe('# Elsewhere')
  })

  test('the format commands write nothing', () => {
    const state = locked()

    for (const command of [
      toggleWrap('**'),
      setHeading(2),
      insertHorizontalRule,
      clearFormatting,
    ]) {
      expect(afterCommand(state, command)).toBe('# Note')
    }
  })

  test('nor does tidying up the note', () => {
    expect(afterCommand(locked(), reformatDocument)).toBe('# Note')
  })
})

describe('source mode and read-only mode', () => {
  /** Whether the live preview is up - which is what source mode takes away. */
  const preview = (state: EditorState) => state.field(blockDecorations, false) !== undefined

  test('are never both on: read-only takes source off', () => {
    const { view } = surface('| a |\n| --- |\n| 1 |')
    setSourceMode(view, true)
    expect(preview(view.state)).toBe(false)

    setReadOnlyMode(view, true)
    expect(preview(view.state)).toBe(true)
    expect(view.state.readOnly).toBe(true)
  })

  test('and source unlocks it', () => {
    const { view } = surface('| a |\n| --- |\n| 1 |')
    setReadOnlyMode(view, true)

    setSourceMode(view, true)
    expect(view.state.readOnly).toBe(false)
    expect(preview(view.state)).toBe(false)
    expect(readOnlyClass(view.state)).toBe(false)
  })
})

/** Every class a mode puts on the editor, as the editor itself writes them. */
function editorClasses(state: EditorState): string[] {
  return state
    .facet(EditorView.editorAttributes)
    .flatMap((attrs) => (typeof attrs === 'object' && attrs.class ? [attrs.class] : []))
}

function direction(state: EditorState): string | undefined {
  return state
    .facet(EditorView.contentAttributes)
    .flatMap((attrs) => (typeof attrs === 'object' && attrs.dir ? [attrs.dir] : []))
    .at(-1)
}

/** A mode that is on and cannot be seen is off in every way that counts.
 *
 *  CodeMirror rewrites its element's class attribute from these facets on
 *  every focus change, so a class put there with `classList` was gone at the
 *  next click somewhere else - the mode stayed on, its styling did not. Reading
 *  mode was written the right way round from the start; these five were not,
 *  and this is what keeps them that way. */
describe('the classes the stylesheet works from', () => {
  const modes: [string, (view: EditorView, on: boolean) => void, string][] = [
    ['focus mode', setFocusMode, 'nib-focus-mode'],
    ['typewriter mode', setTypewriterMode, 'nib-typewriter-mode'],
    // The ligature setting is a scope rather than a switch, and the class is on
    // for every scope that draws a glyph anywhere.
    ['ligatures', (view, on) => setLigatures(view, on ? 'all' : 'off'), 'nib-ligatures'],
    ['numbered headings', setHeadingNumbers, 'nib-numbered'],
    ['code line numbers', setCodeLineNumbers, 'nib-line-numbers'],
    ['right to left', setRightToLeft, 'nib-rtl'],
  ]

  for (const [name, set, className] of modes) {
    test(`${name} hands its class to the editor, and takes it back`, () => {
      const { view } = surface('# Note')
      expect(editorClasses(view.state)).not.toContain(className)

      set(view, true)
      expect(editorClasses(view.state)).toContain(className)

      set(view, false)
      expect(editorClasses(view.state)).not.toContain(className)
    })
  }

  test('right to left sets the writing direction with it', () => {
    const { view } = surface('# Note')
    expect(direction(view.state)).toBe('ltr')

    setRightToLeft(view, true)
    expect(direction(view.state)).toBe('rtl')

    setRightToLeft(view, false)
    expect(direction(view.state)).toBe('ltr')
  })

  test('two modes at once keep both classes', () => {
    const { view } = surface('# Note')
    setFocusMode(view, true)
    setTypewriterMode(view, true)

    expect(editorClasses(view.state)).toEqual(
      expect.arrayContaining(['nib-focus-mode', 'nib-typewriter-mode']),
    )

    setFocusMode(view, false)
    expect(editorClasses(view.state)).toContain('nib-typewriter-mode')
    expect(editorClasses(view.state)).not.toContain('nib-focus-mode')
  })
})

/** Re-applying the modes has to be free.
 *
 *  The app dresses every editor on the page whenever anything about the page
 *  changes, and resizing a pane changes the page on every pointer move. A
 *  reconfiguration that hands a compartment an equal value built again is not
 *  free: a second `markdown()` is a different parser as far as
 *  @codemirror/language is concerned, so it drops the parse of the whole
 *  document and starts over from the top of it with a twenty millisecond
 *  budget. Everything past that has no tree, and a decoration built off no tree
 *  is no decoration - which is how a note went raw for a frame at a time while
 *  the divider between two panes was being dragged. */
describe('applying every mode again', () => {
  const DEFAULTS: ModeSettings = {
    source: false,
    readOnly: false,
    focus: false,
    typewriter: false,
    punctuation: true,
    numbers: false,
    lineNumbers: false,
    codeTheme: 'follow',
    rtl: false,
    strict: false,
    equationNumbers: false,
    spellcheck: false,
    closeBrackets: true,
    ligatures: 'off',
    vim: false,
  }

  /** Longer than one state's parse budget, so a parse thrown away shows. */
  function long(): string {
    const sections: string[] = []
    for (let at = 0; at < 400; at++) {
      sections.push(`## Section ${at}`, '', 'Some **bold** and *italic* text.', '')
    }
    return sections.join('\n')
  }

  function dressed(): EditorState {
    return parsed(EditorState.create({ doc: long(), extensions: modeExtensions() }))
  }

  test('keeps the parse of the whole document', () => {
    const before = dressed()
    const after = before.update({ effects: modeEffects(DEFAULTS) }).state

    expect(syntaxTree(after)).toBe(syntaxTree(before))
  })

  test('leaves the decorations at the far end of the document standing', () => {
    const before = dressed()
    const far = [{ from: before.doc.length - 400, to: before.doc.length }]
    const had = buildDecorations(before, far).decorations.size
    expect(had).toBeGreaterThan(0)

    const after = before.update({ effects: modeEffects(DEFAULTS) }).state
    expect(buildDecorations(after, far).decorations.size).toBe(had)
  })

  test('a mode that did change still takes effect', () => {
    const after = dressed().update({
      effects: modeEffects({ ...DEFAULTS, numbers: true }),
    }).state

    expect(editorClasses(after)).toContain('nib-numbered')
  })
})
