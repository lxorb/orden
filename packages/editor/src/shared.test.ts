import { history, undoDepth } from '@codemirror/commands'
import {
  type ChangeSpec,
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { type DocView, SharedDoc, sharedOf, sharing } from './shared'

/** A view without a DOM: the state a pane holds, and the dispatch a document
 *  reaches it through. The extensions are the two the document needs from a
 *  view, so the history asserted about below is the real one. */
class Pane implements DocView {
  private held: EditorState

  constructor(
    private readonly note: SharedDoc,
    cursor = 0,
  ) {
    this.held = EditorState.create({
      doc: note.text,
      selection: EditorSelection.cursor(cursor),
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

  get caret(): number {
    return this.held.selection.main.head
  }

  /** What the editor does with an edit: applies it, then hands the change over.
   *  See the update listener in editor.ts, which does exactly this. */
  edit(changes: ChangeSpec, cursor: number) {
    const made = this.held.update({
      changes,
      selection: EditorSelection.cursor(cursor),
      userEvent: 'input.type',
    })

    this.held = made.state
    this.note.local(made.changes, made.state.selection, this)
  }

  type(at: number, insert: string) {
    this.edit({ from: at, insert }, at + insert.length)
  }
}

describe('a document in two panes', () => {
  test('carries a change from one pane into the other', () => {
    const note = new SharedDoc('Hello')
    const left = new Pane(note)
    const right = new Pane(note)

    left.type(5, ' there')

    expect(note.text.toString()).toBe('Hello there')
    expect(right.text).toBe('Hello there')
    expect(left.text).toBe('Hello there')
  })

  test('leaves the other pane’s caret where it was', () => {
    const note = new SharedDoc('one two')
    const left = new Pane(note)
    const right = new Pane(note, 7)

    left.type(0, 'zero ')

    // Five characters went in ahead of it, so the same place in the text is
    // five further along. What must not happen is that caret following the
    // typing, which is what replacing the text would have done.
    expect(right.caret).toBe(12)
    expect(left.caret).toBe(5)
  })

  test('says the note changed once per change', () => {
    const note = new SharedDoc('')
    const left = new Pane(note)
    const right = new Pane(note)

    const heard: string[] = []
    note.onChange = (doc) => heard.push(doc.toString())

    left.type(0, 'a')
    right.type(1, 'b')

    expect(heard).toEqual(['a', 'ab'])
  })

  test('records nothing in either pane’s own history', () => {
    const note = new SharedDoc('')
    const left = new Pane(note)
    const right = new Pane(note)

    left.type(0, 'typed')

    expect(undoDepth(left.state)).toBe(0)
    expect(undoDepth(right.state)).toBe(0)
  })

  test('undoes the last edit whichever pane asks', () => {
    // Far apart on purpose: two edits typed next to each other within the
    // moment are one thing done, and CodeMirror's history undoes them together.
    const note = new SharedDoc('one two')
    const left = new Pane(note)
    const right = new Pane(note)

    left.type(0, 'L')
    right.type(8, 'R')
    expect(note.text.toString()).toBe('Lone twoR')

    // Typed in the right pane, undone from the left: one history.
    expect(note.undo(left)).toBe(true)
    expect(left.text).toBe('Lone two')
    expect(right.text).toBe('Lone two')

    expect(note.undo(right)).toBe(true)
    expect(note.text.toString()).toBe('one two')
  })

  test('puts an undone edit back', () => {
    const note = new SharedDoc('')
    const left = new Pane(note)
    const right = new Pane(note)

    left.type(0, 'words')
    note.undo(right)
    expect(note.redo(right)).toBe(true)

    expect(left.text).toBe('words')
    expect(right.text).toBe('words')
  })

  test('answers no when there is nothing left to undo', () => {
    const note = new SharedDoc('as it was')
    const only = new Pane(note)

    expect(note.undo(only)).toBe(false)
    expect(note.redo(only)).toBe(false)
    expect(only.text).toBe('as it was')
  })

  test('takes the caret to the undone edit in the pane that asked', () => {
    const note = new SharedDoc('start')
    const left = new Pane(note)
    const right = new Pane(note)

    // Two edits far enough apart to be two things done rather than one.
    left.type(0, 'A')
    left.type(6, 'B')
    expect(right.caret).toBe(0)

    note.undo(right)

    // The pane that asked lands on the edit that went away. The other keeps
    // its own caret, mapped back through the change rather than moved by it.
    expect(right.caret).toBe(1)
    expect(left.caret).toBe(6)
    expect(right.text).toBe('Astart')
  })

  test('stops carrying changes to a pane that has left', () => {
    const note = new SharedDoc('')
    const left = new Pane(note)
    const right = new Pane(note)

    note.leave(right)
    left.type(0, 'after')

    expect(note.panes).toBe(1)
    expect(right.text).toBe('')
    expect(left.text).toBe('after')
  })

  test('brings a joining pane to the text the document holds', () => {
    const note = new SharedDoc('first')
    const left = new Pane(note)
    left.type(5, ' words')

    const late = new Pane(note)

    expect(late.text).toBe('first words')
    expect(note.panes).toBe(2)
  })

  test('tells every pane which document it is looking at', () => {
    const note = new SharedDoc('')
    const only = new Pane(note)

    expect(sharedOf(only.state)).toBe(note)
  })

  test('puts text from outside into every pane', () => {
    const note = new SharedDoc('old')
    const left = new Pane(note)
    const right = new Pane(note)

    note.replace('restored')

    expect(left.text).toBe('restored')
    expect(right.text).toBe('restored')
    expect(note.text.toString()).toBe('restored')
  })

  test('carries a deletion as a deletion', () => {
    const note = new SharedDoc('keep this word')
    const left = new Pane(note)
    const right = new Pane(note, 14)

    left.edit({ from: 4, to: 9 }, 4)

    expect(right.text).toBe('keep word')
    expect(right.caret).toBe(9)
    expect(note.text.toString()).toBe('keep word')
  })
})

describe('a document with one pane', () => {
  test('is still the one place the words live', () => {
    const note = new SharedDoc('alone')
    const only = new Pane(note)

    only.type(5, '!')

    expect(note.text.toString()).toBe('alone!')
    expect(note.panes).toBe(1)
  })
})
