import { describe, expect, test } from 'vitest'
import type { ProviderKind } from '../../ai-providers/src/providers'
import { availability } from './available'
import { GOAL_CLEAR, ROWS, takenNames } from './table'

const KINDS: readonly ProviderKind[] = [
  'anthropic',
  'openai',
  'compatible',
  'chatgpt',
  'claude-code',
  'codex',
]

describe('the command table', () => {
  test('holds 63 commands and 46 synonyms', () => {
    expect(ROWS).toHaveLength(63)
    expect(ROWS.flatMap((one) => one.synonyms)).toHaveLength(46)
  })

  test("takes clear first among /goal clear's words", () => {
    expect(GOAL_CLEAR[0]).toBe('clear')
  })

  test('takes no name or synonym twice', () => {
    const every = ROWS.flatMap((one) => [one.name, ...one.synonyms])
    expect(new Set(every).size).toBe(every.length)
    expect(takenNames().size).toBe(every.length)
  })

  test('gives every row a few words for the menu', () => {
    for (const row of ROWS) expect(row.description.trim(), row.name).not.toBe('')
  })

  test.each(KINDS)('answers every row for %s: runs, or dimmed with a reason', (kind) => {
    for (const row of ROWS) {
      for (const review of [true, false]) {
        const said = availability(row.name, kind, { review })
        if (said !== true) expect(said.trim(), `${row.name} on ${kind}`).not.toBe('')
      }
    }
  })

  test('dims /fast only where the provider has no faster tier', () => {
    const ready = { review: true }
    const runs = KINDS.filter((kind) => availability('fast', kind, ready) === true)
    expect(runs).toEqual(['anthropic', 'openai', 'codex'])
    for (const row of ROWS.filter((one) => one.name !== 'fast'))
      for (const kind of KINDS) expect(availability(row.name, kind, ready), row.name).toBe(true)
  })

  test("waits for the review lane's half of /rewind and /diff", () => {
    expect(availability('rewind', 'anthropic', { review: false })).not.toBe(true)
    expect(availability('diff', 'codex', { review: false })).not.toBe(true)
  })
})
