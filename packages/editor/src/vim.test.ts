import { history } from '@codemirror/commands'
import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
  type ChangeSpec,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { CodeMirror, Vim } from '@replit/codemirror-vim'
import { modeExtensions } from './modes'
import { type DocView, SharedDoc, sharing } from './shared'
import { loadVim, setVim } from './vim'
import { plainNormalEnter, takeBackNibKeys } from './vim-mode'

beforeAll(() => loadVim())

function surface() {
  let state = EditorState.create({
    doc: 'hello',
    selection: EditorSelection.cursor(0),
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

  return { view: view as unknown as EditorView, current: () => state }
}

function modal(state: EditorState): boolean {
  return state
    .facet(EditorView.editorAttributes)
    .some((attrs) => typeof attrs === 'object' && attrs.class === 'nib-vim')
}

describe('modal editing', () => {
  test('is off until it is asked for', () => {
    expect(modal(surface().current())).toBe(false)
  })

  test('goes on and off in a view that is already open', () => {
    const { view, current } = surface()

    setVim(view, true)
    expect(modal(current())).toBe(true)

    setVim(view, false)
    expect(modal(current())).toBe(false)
  })

  test('leaves the text and the caret exactly where they were', () => {
    const { view, current } = surface()
    setVim(view, true)

    expect(current().doc.toString()).toBe('hello')
    expect(current().selection.main.head).toBe(0)
  })
})

const unmap = Vim.unmap as (keys: string, context?: string) => boolean | undefined

class Pane implements DocView {
  private held: EditorState

  constructor(private readonly note: SharedDoc) {
    this.held = EditorState.create({
      doc: note.text,
      selection: EditorSelection.cursor(0),
      extensions: [history(), sharing()],
    })
    note.join(this)
  }

  get state(): EditorState {
    return this.held
  }

  dispatch(spec: TransactionSpec) {
    this.held = this.held.update(spec).state
  }

  get text(): string {
    return this.held.doc.toString()
  }

  type(at: number, insert: string) {
    this.edit({ from: at, insert }, at + insert.length)
  }

  private edit(changes: ChangeSpec, cursor: number) {
    const made = this.held.update({
      changes,
      selection: EditorSelection.cursor(cursor),
      userEvent: 'input.type',
    })

    this.held = made.state
    this.note.local(made.changes, made.state.selection, this)
  }
}

describe("Vim's undo", () => {
  test('goes to the history of the note rather than of the pane', () => {
    const note = new SharedDoc('alpha')
    const first = new Pane(note)
    const second = new Pane(note)

    first.type(5, ' bravo')
    expect(first.text).toBe('alpha bravo')
    expect(second.text).toBe('alpha bravo')

    CodeMirror.commands.undo({ cm6: first as unknown as EditorView } as CodeMirror)

    expect(first.text).toBe('alpha')
    expect(second.text).toBe('alpha')
  })

  test('and redo comes back the same way', () => {
    const note = new SharedDoc('alpha')
    const pane = new Pane(note)

    pane.type(5, ' bravo')
    const cm = { cm6: pane as unknown as EditorView } as CodeMirror
    CodeMirror.commands.undo(cm)
    CodeMirror.commands.redo(cm)

    expect(pane.text).toBe('alpha bravo')
  })
})

describe('the keys Orden keeps for itself', () => {
  test('are gone from Vim by the time anything imports it, and Ctrl+Q is not one', () => {
    expect(takeBackNibKeys()).toEqual([])

    expect(unmap('<C-q>')).toBe(true)
  })
})

describe('Enter, as normal mode reads it', () => {
  const enter = {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
  }
  const idle = { prefixRepeat: [], operator: null, keyBuffer: [] }
  const normal = { insertMode: false, visualMode: false, inputState: idle }

  test('is a plain Enter in normal mode with nothing typed before it', () => {
    expect(plainNormalEnter(enter, normal)).toBe(true)
  })

  test('is not Enter in insert mode or in visual mode', () => {
    expect(plainNormalEnter(enter, { ...normal, insertMode: true })).toBe(false)
    expect(plainNormalEnter(enter, { ...normal, visualMode: true })).toBe(false)
  })

  test('is not Enter finishing a command: a count, an operator, a register, a sequence', () => {
    expect(
      plainNormalEnter(enter, { ...normal, inputState: { ...idle, prefixRepeat: ['3'] } }),
    ).toBe(false)
    expect(
      plainNormalEnter(enter, { ...normal, inputState: { ...idle, operator: 'delete' } }),
    ).toBe(false)
    expect(plainNormalEnter(enter, { ...normal, inputState: { ...idle, registerName: 'a' } })).toBe(
      false,
    )
    expect(plainNormalEnter(enter, { ...normal, inputState: { ...idle, keyBuffer: ['g'] } })).toBe(
      false,
    )
  })

  test('is not a chord with Enter in it, another key, or a view with no modal editing', () => {
    expect(plainNormalEnter({ ...enter, ctrlKey: true }, normal)).toBe(false)
    expect(plainNormalEnter({ ...enter, shiftKey: true }, normal)).toBe(false)
    expect(plainNormalEnter({ ...enter, isComposing: true }, normal)).toBe(false)
    expect(plainNormalEnter({ ...enter, key: 'j' }, normal)).toBe(false)
    expect(plainNormalEnter(enter, null)).toBe(false)
  })
})
