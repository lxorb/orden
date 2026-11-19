import { renderMarkdown } from '@orden/markdown'
import { namedBlock } from '@orden/markdown/block-names'
import { sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownParser } from './markdown/extensions'

function named(source: string, line: number): { source: string; shown: string | null } {
  const result = namedBlock(source, line, () => 'new123')
  if (!result) throw new Error('not named')
  return {
    source: result.source,
    shown: sectionOf(result.source, { heading: null, block: result.id }),
  }
}
function nodeNames(source: string): string[] {
  const names: string[] = []
  ordenMarkdownParser.parse(source).iterate({ enter: (node) => void names.push(node.name) })
  return names
}
describe('naming a paragraph that holds a line of only = or - signs, which Orden reads as words', () => {
  const EQUALS = 'Intro\nline two\n===\nrest'
  const DASH = 'Intro\n-\nrest'
  test('the editor and the reading view read each note as one paragraph', () => {
    expect(nodeNames(EQUALS)).toEqual(['Document', 'Paragraph'])
    expect(nodeNames(DASH)).toEqual(['Document', 'Paragraph'])
    expect(renderMarkdown(EQUALS)).toBe('<p>Intro\nline two\n===\nrest</p>\n')
  })
  test('naming the words above a line of equals signs does not split the paragraph in two', () => {
    expect(renderMarkdown(named(EQUALS, 0).source)).toBe(renderMarkdown(EQUALS))
  })
  test('a link to the words above a line of equals signs shows the whole paragraph', () => {
    expect(named(EQUALS, 0).shown).toContain('rest')
  })
  test('naming the words above a lone dash does not turn the dash into a list item', () => {
    expect(nodeNames(named(DASH, 0).source)).not.toContain('BulletList')
  })
  test('a link to the words above a lone dash shows those words', () => {
    expect(named(DASH, 0).shown).toContain('Intro')
  })
})
