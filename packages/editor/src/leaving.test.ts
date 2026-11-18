import type { EditorState, StateCommand } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { editorState } from './editor'
import { parsed } from '../test/parsed'

function opened(doc: string): EditorState {
  return parsed(editorState({ doc, selection: { anchor: doc.length } }))
}

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

describe('leaving a list', () => {
  test.each([
    ['- an item', '- an item\n', 2],
    ['1. one', '1. one\n', 2],
    ['- [ ] a task', '- [ ] a task\n', 2],
    ['> a quote', '> a quote\n', 2],
    ['> > deep', '> > deep\n> ', 2],
    ['- one\n    - two', '- one\n    - two\n- ', 2],
    ['- an item', '- an item\n- ', 1],
    ['1. one', '1. one\n2. ', 1],
    ['> a quote', '> a quote\n> ', 1],
  ])('%j', (input, wanted, extra) => expect(pressEnter(input, extra)).toEqual(wanted))
})
