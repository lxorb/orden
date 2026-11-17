import { namedBlock } from '@orden/markdown/block-names'
import { blocksOf, sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

const windows = (text: string) => text.replace(/\n/g, '\r\n')

const shown = (source: string) =>
  sectionOf(source, { heading: null, block: 'p' })?.replace(/\r/g, '')

describe('a named block in a note with Windows line endings', () => {
  test.each([
    ['words above a star rule', 'Para ^p\n***\nNext para\n', 'Para'],
    ['words above an underscore rule', 'Para ^p\n___\nNext para\n', 'Para'],
    ['words above a dash rule', 'Title ^p\n---\nNext para\n', 'Title'],
    ['words above a line of equals signs', 'Title ^p\n===\nNext para\n', 'Title\n===\nNext para'],
    ['words under a dash rule', 'Title\n---\nPara ^p\nmore\n', 'Para\nmore'],
  ])('%s shows the same block as with Unix line endings', (_, unix, block) => {
    expect(shown(unix)).toBe(block)
    expect(shown(windows(unix))).toBe(block)
  })

  test('words under a rule are offered as a block of their own', () => {
    const unix = 'Para\n***\nNext para\n'
    const lines = (source: string) => blocksOf(source).map((one) => one.line)
    expect(lines(windows(unix))).toEqual(lines(unix))
  })

  test('naming words right above a rule writes the id on those words', () => {
    const named = namedBlock(windows('Some text\n***\nmore words\n'), 0, () => 'n1')
    expect(named?.source.split('\r\n')[0]).toBe('Some text ^n1')
  })
})
