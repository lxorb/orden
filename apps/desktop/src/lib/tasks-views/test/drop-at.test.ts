import { expect, test } from 'vitest'
import { dropAt } from '../src/drop-at'

const box = { top: 100, height: 40 }
test('a card dropped on the upper half of another goes before it', () => {
  expect(dropAt(1, 110, box)).toBe(1)
})
test('a card dropped on the lower half of another goes after it, so the card below can be passed', () => {
  expect(dropAt(1, 130, box)).toBe(2)
})
