import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type TransactionSpec,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { describe, expect, test } from 'vitest'
import { insertHorizontalRule, setHeading, toggleWrap } from './commands'
import { external } from './external'
import { clearFormatting } from './marks'
import { blockDecorations } from './live-preview'
import { buildDecorations } from './live-preview/decorate'
import {
  modeEffects,
  type ModeSettings,
  modeExtensions,
  parsedFully,
  setCodeLineNumbers,
  setEquationNumbers,
  setFocusMode,
  setHeadingNumbers,
  setLigatures,
  setReadOnlyMode,
  setRightToLeft,
  setSourceMode,
  setTypewriterMode,
  tooLongToParse,
} from './modes'
import { reformatDocument } from './reformat'
import { parsed } from '../test/parsed'

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

function readOnlyClass(state: EditorState): boolean {
  return state
    .facet(EditorView.editorAttributes)
    .some((attrs) => typeof attrs === 'object' && attrs.class === 'nib-read-only')
}

function concealed(state: EditorState): string[] {
  const out: string[] = []
  buildDecorations(state).atomic.between(0, state.doc.length, (from, to) => {
    out.push(state.doc.sliceString(from, to))
  })
  return out
}

function rendered(state: EditorState): string[] {
  const out: string[] = []
  state.field(blockDecorations).decorations.between(0, state.doc.length, (from, to) => {
    out.push(state.doc.sliceString(from, to))
  })
  return out
}

function afterChange(state: EditorState, spec: TransactionSpec): string {
  return state.update(spec).state.doc.toString()
}

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

const DEFAULTS: ModeSettings = {
  source: false,
  readOnly: false,
  focus: false,
  quietMarks: false,
  typewriter: false,
  punctuation: true,
  numbers: false,
  lineNumbers: false,
  codeTheme: 'follow',
  rtl: false,
  strict: false,
  equationNumbers: false,
  properties: 'properties',
  spellcheck: false,
  closeBrackets: true,
  ligatures: 'off',
  vim: false,
}

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

describe('the classes the stylesheet works from', () => {
  const modes: [string, (view: EditorView, on: boolean) => void, string][] = [
    ['focus mode', setFocusMode, 'nib-focus-mode'],
    ['typewriter mode', setTypewriterMode, 'nib-typewriter-mode'],
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

describe('applying every mode again', () => {
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

describe('a document too long to parse', () => {
  function note(characters: number): string {
    const lines: string[] = []
    let held = 0
    for (let at = 0; held < characters; at++) {
      const line =
        at % 12 === 0 ? `## Part ${at}` : `Line ${at} with **bold**, *italic* and a [[link]] in it.`
      lines.push(line)
      held += line.length + 1
    }

    return lines.join('\n')
  }

  const SHORT = note(64 * 1024)
  const LONG = note(1024 * 1024)

  function opened(doc: string): EditorState {
    const made = EditorState.create({ doc, extensions: modeExtensions(doc.length) })
    return made.update({ effects: modeEffects(DEFAULTS) }).state
  }

  test('is not parsed at all, and a short one still is', () => {
    expect(parsedFully(opened(SHORT))).toBe(true)
    expect(parsedFully(opened(LONG))).toBe(false)
  })

  test('and is built that way rather than turned plain a transaction later', () => {
    const made = EditorState.create({ doc: LONG, extensions: modeExtensions(LONG.length) })

    expect(parsedFully(made)).toBe(false)
    ensureSyntaxTree(made, made.doc.length, 10_000)
    expect(syntaxTree(made).length).toBe(0)
  })

  test('so nothing of it is walked, however long the parse is given', () => {
    const long = opened(LONG)
    ensureSyntaxTree(long, long.doc.length, 10_000)
    expect(syntaxTree(long).length).toBe(0)

    const short = opened(SHORT)
    ensureSyntaxTree(short, short.doc.length, 10_000)
    expect(syntaxTree(short).length).toBeGreaterThan(0)
  })

  test('and the words, the lines and the caret are all still there', () => {
    const long = opened(LONG)

    expect(long.doc.toString()).toBe(LONG)
    expect(long.doc.lines).toBe(LONG.split('\n').length)

    const typed = long.update({ changes: { from: long.doc.length, insert: 'x' } }).state
    expect(typed.doc.sliceString(typed.doc.length - 1)).toBe('x')
    expect(parsedFully(typed)).toBe(false)
  })

  test('a document that grows past the size loses its parse', () => {
    const short = opened(SHORT)
    expect(parsedFully(short)).toBe(true)

    const grown = short.update({ changes: { from: short.doc.length, insert: LONG } }).state
    expect(parsedFully(grown)).toBe(false)
  })

  test('and one that is cut back below it gets the parse again', () => {
    const long = opened(LONG)
    const cut = long.update({ changes: { from: SHORT.length, to: long.doc.length } }).state

    expect(parsedFully(cut)).toBe(true)
    ensureSyntaxTree(cut, cut.doc.length, 10_000)
    expect(syntaxTree(cut).length).toBeGreaterThan(0)
  })

  test('a mode set on a long document does not put the parse back', () => {
    const long = opened(LONG)
    const again = long.update({ effects: modeEffects({ ...DEFAULTS, numbers: true }) }).state

    expect(parsedFully(again)).toBe(false)
    expect(editorClasses(again)).toContain('nib-numbered')
  })

  test('and strict mode on a short one is still strict', () => {
    const strict = opened(SHORT).update({
      effects: modeEffects({ ...DEFAULTS, strict: true }),
    }).state

    expect(parsedFully(strict)).toBe(true)
    expect(tooLongToParse(strict.doc.length)).toBe(false)
  })
})
