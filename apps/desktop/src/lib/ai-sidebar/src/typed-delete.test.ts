import { expect, test } from 'vitest'
import { deletesTyped } from './typed-delete'

const at = (value: string, start: number, end = start) => ({
  value,
  selectionStart: start,
  selectionEnd: end,
})

test('Delete with words after the caret, or a selection, deletes what was typed', () => {
  expect(deletesTyped(at('plan', 1))).toBe(true)
  expect(deletesTyped(at('plan', 0, 4))).toBe(true)
})

test('Delete at the end of the field, or in an empty one, is left to the list', () => {
  expect(deletesTyped(at('plan', 4))).toBe(false)
  expect(deletesTyped(at('', 0))).toBe(false)
})
