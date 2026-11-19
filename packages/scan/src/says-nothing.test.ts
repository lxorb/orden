import { describe, expect, test } from 'vitest'
import { saysNothing, scanNote } from './scan-note'

describe('a note that says nothing yet', () => {
  test('is read on the scan the index makes of every note, under the file s name', () => {
    expect(scanNote('Trips/Plan.md', '# Plan\n').bare).toBe(true)
    expect(scanNote('Trips/Plan.md', '# Plan\nWords\n').bare).toBe(false)
  })
})
test.each<[unknown, ...Parameters<typeof saysNothing>]>([
  [true, '', 'Plan'],
  [true, '  \n\n\t\n', 'Plan'],
  [true, '# Plan\n\n', 'Plan'],
  [true, '## Plan ##\r\n\r\n', 'Plan'],
  [true, '# Q1: costs\n', 'Q1 costs'],
  [true, '---\nicon: rocket\ntitle: Plan\n---\n\n', 'Plan'],
  [true, '---\ntitle: Plan\n---\n# Plan\n', 'Plan'],
  [false, '# Plan\n\nWords.\n', 'Plan'],
  [false, '# Another\n', 'Plan'],
  [false, 'Plan\n', 'Plan'],
  [false, '# Plan\n- [ ] task\n', 'Plan'],
  [false, '#Plan\n', 'Plan'],
])('%j from %j', (expected, ...args) => {
  expect(saysNothing(...args)).toBe(expected)
})
