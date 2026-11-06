import { describe, expect, test } from 'vitest'
import { flowSource } from './flow'

describe('the source of a flowchart', () => {
  test('keeps the words of a box and loses the call a press would make', () => {
    expect(flowSource('st=>start: Start:$pressed\ne=>end: End\nst->e')).toBe(
      'st=>start: Start\ne=>end: End\nst->e',
    )
  })

  test('leaves a box that names no hook as it was written', () => {
    const code = 'st=>start: Costs $5\nop=>operation: Pay:>https://example.com\nst->op'
    expect(flowSource(code)).toBe(code)
  })
})
