import { describe, expect, test } from 'vitest'
import { contextAt } from './fixtures/rows'
import { summarize } from './summaries'

describe('a summary of a column of many rows', () => {
  const many = Array.from({ length: 300_000 }, (_, at) => (at * 7919) % 300_001)

  test('finds its least, most and range without passing every value as an argument', () => {
    const context = contextAt()
    expect(summarize('Min', many, {}, context)).toBe(0)
    expect(summarize('Max', many, {}, context)).toBe(300_000)
    expect(summarize('Range', many, {}, context)).toBe(300_000)
  })
})
