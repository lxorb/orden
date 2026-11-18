import type { EditorState, StateCommand } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { editorState } from './editor'
import { parsed } from '../test/parsed'

function opened(doc: string, caret = doc.length): EditorState {
  return parsed(editorState({ doc, selection: { anchor: caret } }))
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

function pressEnter(doc: string, times: number, caret = doc.length): string {
  let state = opened(doc, caret)

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
    expect(pressEnter('- an item', 2)).toBe('- an item\n\n')
  })

  test('a second Enter ends an ordered list', () => {
    expect(pressEnter('1. one', 2)).toBe('1. one\n\n')
  })

  test('a second Enter ends a task list', () => {
    expect(pressEnter('- [ ] a task', 2)).toBe('- [ ] a task\n\n')
  })

  test('a second Enter ends a quote', () => {
    expect(pressEnter('> a quote', 2)).toBe('> a quote\n\n')
  })

  test('a second Enter leaves the inner quote and stays in the outer one', () => {
    expect(pressEnter('> > deep', 2)).toBe('> > deep\n>\n> ')
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

describe('a line that only looks like an empty quote', () => {
  test('inside quoted code, Enter adds a blank code line and keeps the block', () => {
    const doc = '> ```\n> x\n> ```'
    expect(pressEnter(doc, 2, doc.indexOf('x') + 1)).toBe('> ```\n> x\n> \n> \n> ```')
  })

  test('inside plain code or an HTML block, Enter is a plain new line', () => {
    expect(pressEnter('```\n>\n```', 1, 5)).toBe('```\n>\n\n```')
    expect(pressEnter('<div\n  class="x"\n>', 1)).toBe('<div\n  class="x"\n>\n')
  })
})
