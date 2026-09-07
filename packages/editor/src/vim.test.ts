import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { Vim } from '@replit/codemirror-vim'
import { modeExtensions } from './modes'
import { setVim, takeBackNibKeys } from './vim'

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
