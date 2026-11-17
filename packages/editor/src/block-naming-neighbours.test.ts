import { namedBlock } from '@orden/markdown/block-names'
import { sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

function shownAfterNaming(source: string, line: number): string | null {
  const result = namedBlock(source, line, () => 'new123')
  if (!result) throw new Error('not named')
  return sectionOf(result.source, { heading: null, block: result.id })
}

describe('naming a block that touches a block of another kind', () => {
  test('a heading with words right under it is named, not the words', () => {
    expect(shownAfterNaming('# Title\nSome text\n', 0)).toContain('Title')
  })

  test('words right above a heading are named, not the heading', () => {
    expect(shownAfterNaming('Some text\n# Title\n', 0)).toContain('Some text')
  })

  test('words right above a quote are named, not the quote', () => {
    expect(shownAfterNaming('Some text\n> quoted\n', 0)).toContain('Some text')
  })
})
