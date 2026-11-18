import { expect, test } from 'vitest'
import { namedBlock } from './block-names'
import { sectionOf } from './links'

const named = (source: string, line: number) => namedBlock(source, line, () => 'pick')

const embedded = (source: string) => sectionOf(source, { heading: null, block: 'pick' })

test('naming a tab-indented code block under a bullet writes the id line with the tab lead', () => {
  const source = '- Setup\n\n\t```\n\tnpm i\n\t```\n'
  const picked = named(source, 3)
  expect(picked?.source).toBe('- Setup\n\n\t```\n\tnpm i\n\t```\n\n\t^pick\n')
  expect(embedded(picked?.source ?? '')).toBe('```\nnpm i\n```')
})

test('naming a tab-indented code block under a numbered step keeps the id inside the step', () => {
  const source = '1. Install\n\n\t```\n\tnpm i\n\t```\n'
  const picked = named(source, 3)
  expect(picked?.source).toBe('1. Install\n\n\t```\n\tnpm i\n\t```\n\n\t^pick\n')
  expect(embedded(picked?.source ?? '')).toBe('```\nnpm i\n```')
})

test('naming a tab-indented table under a bullet writes no stray table words', () => {
  const source = '- Prices\n\n\t| a | b |\n\t| - | - |\n\t| 1 | 2 |\n'
  const picked = named(source, 4)
  expect(picked?.source).toBe('- Prices\n\n\t| a | b |\n\t| - | - |\n\t| 1 | 2 |\n\n\t^pick\n')
})
