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
import { takeBackNibKeys } from './vim-mode'

// The library is loaded the first time modal editing is asked for; these tests turn
// the mode on and read the state in the same breath, which in the app is a keymap
// arriving in the next frame and here would be a keymap that never arrived. Once, for
// the file: it is the library's own keymap and there is one of it. See vim.ts.
beforeAll(() => loadVim())

/** A view is a DOM thing and these tests are not, so this is all the setter
 *  under test actually touches: a state to dispatch into. */
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

/** The class the stylesheet and the tests work from, as the editor itself will
 *  write it onto its element rather than as something put there by hand. */
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

/** `unmap` is declared as needing a context, and a binding that names none is
 *  matched by passing none; the same reading vim.ts makes. */
const unmap = Vim.unmap as (keys: string, context?: string) => boolean | undefined

/** A view without a DOM that has joined a shared document, which is what every
 *  pane in the app is: the text and the history live beside it, and its own
 *  history is deliberately left empty. See shared.ts. */
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

  /** What the editor does with an edit: applies it, then hands it over. */
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
  /** The bug this is here for: `u` went to the view's own history, which is
   *  empty on purpose, so nothing happened. A note open in two panes is one
   *  note with one history, and undo has to mean the same thing in both. */
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

describe('the keys Nib keeps for itself', () => {
  /** `unmap` answers true while it is still finding a binding to remove, so a
   *  second sweep finding nothing is the proof that the first one was
   *  complete. This is what catches a Ctrl chord the library adds in a later
   *  version, before it starts swallowing somebody's Ctrl+P.
   *
   *  Both halves in one test, in this order, because the second takes a key
   *  off the library's own table and there is one of it. */
  test('are gone from Vim by the time anything imports it, and Ctrl+Q is not one', () => {
    expect(takeBackNibKeys()).toEqual([])

    // Vim binds Ctrl+Q because a terminal eats Ctrl+V, and Nib spends Ctrl+V
    // the same way: the settings say the clipboard belongs to the system. So
    // that one is left alone, and visual block lives there.
    expect(unmap('<C-q>')).toBe(true)
  })
})
