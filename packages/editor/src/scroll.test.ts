import { expect, test } from 'vitest'
import { placeAt } from './scroll'

test('the first line is the top of the note, room over the title and all', () => {
  expect(placeAt(0)).toBeNull()
})

test('any other line is put against the top', () => {
  expect(placeAt(42)).not.toBeNull()
})
