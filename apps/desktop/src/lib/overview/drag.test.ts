import { expect, test } from 'vitest'
import { isDrag } from './drag'

test('a few pixels of wobble is still a press', () => {
  expect(isDrag(3, 3)).toBe(false)
  expect(isDrag(6, 0)).toBe(true)
})
