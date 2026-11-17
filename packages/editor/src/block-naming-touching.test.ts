import { namedBlock } from '@orden/markdown/block-names'
import { sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

function shownAfterNaming(source: string, line: number): string | null {
  const result = namedBlock(source, line, () => 'new123')
  if (!result) throw new Error('not named')
  return sectionOf(result.source, { heading: null, block: result.id })
}

describe('naming words or a heading that touch a block of another kind', () => {
  test('words right above a code fence are named, not the code', () => {
    expect(shownAfterNaming('Some text\n```\nlet a = 1\n```\n\nafter\n', 0)).toContain('Some text')
  })

  test('words right above a rule are named, not the rule', () => {
    expect(shownAfterNaming('Some text\n***\n\nafter\n', 0)).toContain('Some text')
  })

  test('a setext heading underlined with dashes is named, not the rule under it', () => {
    expect(shownAfterNaming('Title\n-----\n\nmore\n', 0)).toContain('Title')
  })

  test('a setext heading with words right under it is named, not the words', () => {
    expect(shownAfterNaming('Title\n---\nmore words\n', 0)).toContain('Title')
  })

  test('a setext heading with words right under it is named alone', () => {
    expect(shownAfterNaming('Title\n=====\nmore words\n', 0)).not.toContain('more words')
  })
})
