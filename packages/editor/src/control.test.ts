import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { refuseControlCharacters, unprintable } from './control'

function refused(typed: string): boolean {
  const state = EditorState.create({ extensions: [refuseControlCharacters()] })
  const view = { state } as unknown as EditorView
  return state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, 0, 0, typed, () => state.update({})))
}

describe('a control character typed', () => {
  test.each([
    ['\u0011', true],
    ['\u0012', true],
    ['\u001e', true],
    ['\u007f', true],
    ['\t', false],
    ['\n', false],
    ['\r\n', false],
    ['a', false],
    ['´', false],
    ['\u0011a', false],
    [' ', false],
  ])('%j', (input, wanted) => expect(refused(input)).toEqual(wanted))

  test('and nothing at all is not typing', () => {
    expect(unprintable('')).toBe(false)
  })
})
