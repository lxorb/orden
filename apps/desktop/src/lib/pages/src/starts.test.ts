import { expect, test } from 'vitest'
import { pans } from './starts'

test('a press on a page that cannot be written moves the view, whatever tool is chosen', () => {
  for (const tool of ['select', 'draw', 'erase', 'lasso', 'words', 'hand'])
    expect(pans(tool, true, false), tool).toBe(true)
})
test('a press on a page that can be written is the tool’s, unless the tool is the hand', () => {
  expect(pans('draw', true, true)).toBe(false)
  expect(pans('select', true, true)).toBe(false)
  expect(pans('hand', true, true)).toBe(true)
})
test('a press beside every page moves the view', () => {
  expect(pans('draw', false, true)).toBe(true)
})
