/** One document, however many views are looking at it.
 *
 *  A note shown in two panes is one note, and this is what makes that true.
 *  The text and the undo history live here, in a state of their own with no
 *  view attached; every view is a window onto it. A view that is typed in
 *  applies the keystroke itself, which is what keeps typing feeling immediate,
 *  and hands the change over: it is applied to the document and dispatched into
 *  every other view as the same change, mapped into that view's own state.
 *
 *  Mapped, never replaced. Replacing the text of the other view would cost a
 *  pass over the whole note on every keystroke and would take that view's
 *  caret and scroll with it; a change set is the size of what was typed, and
 *  every position the other view holds - its caret, its selection, its scroll -
 *  is mapped through it by CodeMirror for nothing.
 *
 *  The history is the document's rather than the view's, so undo means the same
 *  thing in either pane. While a view is joined here nothing it does is
 *  recorded in its own history (see `sharing` below); undo and redo are asked
 *  of the document and come back as a change like any other. */

import { history, redo, undo } from '@codemirror/commands'
import {
  type ChangeSet,
  type EditorSelection,
  EditorState,
  type Extension,
  type StateCommand,
  StateEffect,
  StateField,
  type Text,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import type { Command } from '@codemirror/view'
import { external } from './external'

/** As much of a view as a document needs: the state it is holding, and a way to
 *  hand it a change. A CodeMirror `EditorView` is one; so is a state with a
 *  dispatch, which is what a test without a DOM hands over. */
export interface DocView {
  readonly state: EditorState
  dispatch(spec: TransactionSpec): void
}

/** Which document a view is looking at. Set through the effect below rather
 *  than given at creation, because a view outlives the note in it: the one tab
 *  that previews a note moves on to another without being rebuilt. */
const setShared = StateEffect.define<SharedDoc | null>()

const sharedField = StateField.define<SharedDoc | null>({
  create: () => null,
  update: (current, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setShared)) return effect.value
    }

    return current
  },
})

/** The document a view is joined to, or null for a view that owns its text
 *  alone. Absent rather than null in a state built without `sharing()`. */
export function sharedOf(state: EditorState): SharedDoc | null {
  return state.field(sharedField, false) ?? null
}

/** Where a change should leave the caret, in the one view that asked for it. */
interface Landing {
  view: DocView
  selection: EditorSelection
}

export class SharedDoc {
  /** The document itself: the text, and the history of what was done to it.
   *  No language, no decorations, nothing that draws, so applying a change to
   *  it costs the edit and not the note. */
  private state: EditorState

  private readonly views = new Set<DocView>()

  /** Called whenever the document changes, once per change however many views
   *  are open on it. The app writes the words down from here, so it hears about
   *  a keystroke in either pane exactly once. */
  onChange: ((doc: Text) => void) | null = null

  constructor(doc: string | Text = '') {
    this.state = EditorState.create({ doc, extensions: [history()] })
  }

  /** The rope, for a view being built on it and for anyone who wants the words.
   *  Turning it into a string is the caller's decision, and costs a pass. */
  get text(): Text {
    return this.state.doc
  }

  /** How many views are on it. Two is the same note in two panes. */
  get panes(): number {
    return this.views.size
  }

  /** Takes a view on. Its text is brought to the document's, which is what a
   *  view built for another note and pointed at this one needs; a view built
   *  from `text` above holds the same rope already and only takes the effect. */
  join(view: DocView) {
    this.views.add(view)

    const same = view.state.doc.eq(this.state.doc)
    view.dispatch({
      ...(same ? {} : { changes: { from: 0, to: view.state.doc.length, insert: this.state.doc } }),
      effects: setShared.of(this),
      annotations: external.of(true),
    })
  }

  /** Lets a view go. The view keeps the text it has: whether it is about to be
   *  destroyed or pointed at another note is the caller's business. */
  leave(view: DocView) {
    this.views.delete(view)
  }

  /** A change a view made. Applied to the document and to the other views.
   *
   *  The selection is the one the view that typed ended up with, and it goes on
   *  the document too, so undoing this edit later comes back to where it was
   *  made rather than to wherever another pane happens to be. */
  local(changes: ChangeSet, selection: EditorSelection, from: DocView) {
    this.state = this.state.update({ changes, selection }).state

    this.carry(changes, from)
    this.onChange?.(this.state.doc)
  }

  /** Text put into the document from outside: a version restored, a note a sync
   *  brought over, a rename that rewrote the title. Undoable, the way it is in
   *  a single view. */
  replace(text: string) {
    const made = this.state.update({
      changes: { from: 0, to: this.state.doc.length, insert: text },
    })

    this.state = made.state
    this.carry(made.changes, null)
    this.onChange?.(this.state.doc)
  }

  undo(asked: DocView): boolean {
    return this.step(undo, asked)
  }

  redo(asked: DocView): boolean {
    return this.step(redo, asked)
  }

  /** Undo or redo, on the document's own history. The pane that asked follows
   *  the caret to what changed, because that is what undo means to whoever
   *  pressed it; the other panes take the change and keep their place. */
  private step(command: StateCommand, asked: DocView): boolean {
    // Held in an object rather than a variable: the compiler cannot see that
    // the dispatch below runs before the next line, and would read a plain
    // `let` as still null.
    const made: { transaction: Transaction | null } = { transaction: null }

    const ran = command({
      state: this.state,
      dispatch: (transaction) => {
        made.transaction = transaction
      },
    })

    const done = made.transaction
    if (!ran || !done) return false

    this.state = done.state
    this.carry(done.changes, null, { view: asked, selection: done.state.selection })
    this.onChange?.(this.state.doc)
    return true
  }

  /** One change into every view except the one it came from.
   *
   *  Nothing here may be refused. A view that turned a change down - reading
   *  mode refuses anything nobody typed, a filter of any other kind - would
   *  hold a document that is no longer this one, so the filters are skipped
   *  rather than trusted to agree. */
  private carry(changes: ChangeSet, from: DocView | null, landing?: Landing) {
    for (const view of this.views) {
      if (view === from) continue

      view.dispatch({
        changes,
        ...(landing?.view === view ? { selection: landing.selection, scrollIntoView: true } : {}),
        annotations: external.of(true),
        filter: false,
      })
    }
  }
}

/** What a view needs to be able to join a document.
 *
 *  The history is the second half of it. While a view is joined, every
 *  transaction it makes is kept out of its own history: the document's is the
 *  one that answers Ctrl+Z, and two histories over one text would undo the same
 *  keystroke twice. CodeMirror still maps what a history holds through every
 *  change that arrives, so a view that leaves and goes back to owning its text
 *  starts from an empty history rather than a stale one. */
export function sharing(): Extension {
  return [
    sharedField,
    EditorState.transactionExtender.of((transaction) =>
      sharedOf(transaction.startState) ? { annotations: Transaction.addToHistory.of(false) } : null,
    ),
  ]
}

/** Undo and redo, asked of the document when there is one and of the view
 *  otherwise. What the keymap binds, so a rebound key reaches both. */
export const undoEdit: Command = (view) => {
  const shared = sharedOf(view.state)
  return shared ? shared.undo(view) : undo(view)
}

export const redoEdit: Command = (view) => {
  const shared = sharedOf(view.state)
  return shared ? shared.redo(view) : redo(view)
}
