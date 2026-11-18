import { describe, expect, test } from 'vitest'
import { flowSource } from './flow'

describe('the source of a flowchart', () => {
  test.each([
    ['st=>start: Start:$pressed\ne=>end: End\nst->e', 'st=>start: Start\ne=>end: End\nst->e'],
    [
      'st=>start: Costs $5\nop=>operation: Pay:>https://example.com\nst->op',
      'st=>start: Costs $5\nop=>operation: Pay:>https://example.com\nst->op',
    ],
  ])('%j', (input, wanted) => expect(flowSource(input)).toBe(wanted))
})
