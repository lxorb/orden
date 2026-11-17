import { namedBlock } from '@orden/markdown/block-names'
import { sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

function shownAfterNaming(source: string, line: number): string | null {
  const result = namedBlock(source, line, () => 'new123')
  if (!result) throw new Error('not named')
  return sectionOf(result.source, { heading: null, block: result.id })
}

describe('naming words that touch a block of another kind', () => {
  test('words right above a code fence are named, not the code', () => {
    expect(shownAfterNaming('Some text\n```\nlet a = 1\n```\n\nafter\n', 0)).toContain('Some text')
  })

  test('words right above a rule are named, not the rule', () => {
    expect(shownAfterNaming('Some text\n***\n\nafter\n', 0)).toContain('Some text')
  })

  test('words above a long dash rule are named, not the rule', () => {
    expect(shownAfterNaming('Title\n-----\n\nmore\n', 0)).toContain('Title')
  })

  test('words above a rule with words under it are named, not the words', () => {
    expect(shownAfterNaming('Title\n---\nmore words\n', 0)).toContain('Title')
  })

  test('a line of equals signs stays part of its paragraph, as Orden has no setext headings', () => {
    expect(shownAfterNaming('Title\n=====\nmore words\n', 0)).toBe('Title\n=====\nmore words')
  })
})
