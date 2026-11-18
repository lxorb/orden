import { expect, test } from 'vitest'
import { loadParsers } from '../src/api'

test('the parsers a code fence is highlighted with are found by a language name or its alias, and none for a language nobody knows', async () => {
  const parsers = await loadParsers(['ts', 'Python', 'no-such-language'])
  expect([...parsers.keys()].sort()).toEqual(['Python', 'ts'])
})
