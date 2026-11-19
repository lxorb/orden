import { expect, test } from 'vitest'
import { spaced } from './dictation'

test.each([
  ['.', 'And then we left', ' And then we left'],
  ['d', 'and then we left', ' and then we left'],
  [' ', 'and then', 'and then'],
  ['\n', 'and then', 'and then'],
  ['', 'The plan', 'The plan'],
  ['.', '', ''],
])('a sentence after %j is given a space only where none is in front of it: %j', (before, words, put) => {
  expect(spaced(before, words)).toBe(put)
})
