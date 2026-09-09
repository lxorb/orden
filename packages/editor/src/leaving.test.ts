import type { EditorState, StateCommand } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { editorState } from './editor'
import { parsed } from '../test/parsed'

/** A state the editor itself built, with the caret at the end of the document.
 *  Built through `editorState` rather than from the mode alone, so what is under
 *  test is the Enter the editor actually installs. */
function opened(doc: string): EditorState {
  return parsed(editorState({ doc, selection: { anchor: doc.length } }))
}

/** Every Enter the editor binds, in the order a keymap would try them. Facet
 *  values come back highest precedence first, which is that order.
 *
 *  CodeMirror types every binding as wanting a whole `EditorView`, because a
 *  binding may be a view command. The three that answer Enter here read the
 *  state and call `dispatch`, which is exactly the `StateCommand` contract, and
 *  a state is all a test without a DOM has to give them. */
function enterCommands(state: EditorState): StateCommand[] {
  const found = state
    .facet(keymap)
    .flat()
    .filter((binding) => binding.key === 'Enter')
    .map((binding) => binding.run as StateCommand | undefined)
    .filter((run): run is StateCommand => run !== undefined)

  if (!found.length) throw new Error('the editor binds no Enter')
  return found
}

/** Pressing Enter, as many times as asked. The first command to take the key
 *  ends the press, the way a keymap works. */
function pressEnter(doc: string, times: number): string {
  let state = opened(doc)

  for (let press = 0; press < times; press++) {
    let next = state
    for (const run of enterCommands(state)) {
      if (run({ state, dispatch: (transaction) => (next = transaction.state) })) break
    }
    state = parsed(next)
  }

  return state.doc.toString()
}

/** A list ends where the writer stops writing it, and the way anyone says so is
 *  by pressing Enter on the empty item. Typora, Obsidian and GitHub all end the
 *  list on that press, and the editor this one is modelled on is Typora.
 *
 *  CodeMirror's own binding takes three presses instead: the first continues the
 *  list, the second turns a tight list into a loose one by pushing a blank line
 *  in above the marker, and only the third takes the marker away. The writer is
 *  left with a stray blank line and a bullet to delete by hand. */
describe('leaving a list', () => {
  test('a second Enter ends a bullet list', () => {
    expect(pressEnter('- an item', 2)).toBe('- an item\n')
  })

  test('a second Enter ends an ordered list', () => {
    expect(pressEnter('1. one', 2)).toBe('1. one\n')
  })

  test('a second Enter ends a task list', () => {
    expect(pressEnter('- [ ] a task', 2)).toBe('- [ ] a task\n')
  })

  test('a second Enter ends a quote', () => {
    expect(pressEnter('> a quote', 2)).toBe('> a quote\n')
  })

  /** One level per press, which is what leaving a nested list does too. */
  test('a second Enter leaves the inner quote and stays in the outer one', () => {
    expect(pressEnter('> > deep', 2)).toBe('> > deep\n> ')
  })

  test('a second Enter steps out of the inner list, not out of both', () => {
    expect(pressEnter('- one\n    - two', 2)).toBe('- one\n    - two\n- ')
  })

  /** The first press is untouched: that is the one that carries the list on. */
  test('the first Enter still carries the marker down', () => {
    expect(pressEnter('- an item', 1)).toBe('- an item\n- ')
    expect(pressEnter('1. one', 1)).toBe('1. one\n2. ')
    expect(pressEnter('> a quote', 1)).toBe('> a quote\n> ')
  })
})
