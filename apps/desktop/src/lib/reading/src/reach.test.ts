import { expect, test } from 'vitest'
import { reachKey, type Reaching } from './reach'

const index = (made: readonly string[], version = 0): Reaching => ({
  version,
  reachedOf: (_from, link) => (made.includes(link.target) ? `${link.target}.md` : null),
})

test('what a note reads as changes once a note it links to is made, and not on every other save', () => {
  const doc = 'See [[Plan]] and [[Later]].'
  const before = reachKey(doc, 'Start.md', index(['Plan']))
  expect(reachKey(doc, 'Start.md', index(['Plan'], 7))).toBe(before)
  expect(reachKey(doc, 'Start.md', index(['Plan', 'Later'], 8))).not.toBe(before)
})

test('a note that embeds or asks follows every change of the index', () => {
  for (const doc of ['![[Plan]]', '```query\ntag:x\n```']) {
    expect(reachKey(doc, 'Start.md', index([], 1))).not.toBe(
      reachKey(doc, 'Start.md', index([], 2)),
    )
  }
})
