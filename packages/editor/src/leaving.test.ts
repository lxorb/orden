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

  test('a second Enter leaves the inner quote and stays in the outer one', () => {
    expect(pressEnter('> > deep', 2)).toBe('> > deep\n> ')
  })

  test('a second Enter steps out of the inner list, not out of both', () => {
    expect(pressEnter('- one\n    - two', 2)).toBe('- one\n    - two\n- ')
  })

  test('the first Enter still carries the marker down', () => {
    expect(pressEnter('- an item', 1)).toBe('- an item\n- ')
    expect(pressEnter('1. one', 1)).toBe('1. one\n2. ')
    expect(pressEnter('> a quote', 1)).toBe('> a quote\n> ')
  })
})
