import { expect, test } from 'vitest'
import { namedBlock } from './block-names'
import { sectionOf } from './links'

const named = (source: string, line: number) => namedBlock(source, line, () => 'pick')
const embedded = (source: string) => sectionOf(source, { heading: null, block: 'pick' })
test('naming a tab-indented table under a bullet writes no stray table words', () => {
  const source = '- Prices\n\n\t| a | b |\n\t| - | - |\n\t| 1 | 2 |\n'
  const picked = named(source, 4)
  expect(picked?.source).toBe('- Prices\n\n\t| a | b |\n\t| - | - |\n\t| 1 | 2 |\n\n\t^pick\n')
})
test('an embed of a space-indented parent keeps its tab-indented child under it', () => {
  expect(embedded('- top\n  - parent ^pick\n\t- child\n')).toBe('- parent\n  - child')
})
