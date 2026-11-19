import { namedBlock } from '@orden/markdown/block-names'
import { blocksOf, sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

const windows = (text: string) => text.replace(/\n/g, '\r\n')
const shown = (source: string) => sectionOf(source, { heading: null, block: 'p' })?.replace(/\r/g, '')
describe('a named block in a note with Windows line endings', () => {
  test.each([
    ['words above a star rule', 'Para ^p\n***\nNext para\n'],
    ['words above an underscore rule', 'Para ^p\n___\nNext para\n'],
    ['words above a dash rule', 'Title ^p\n---\nNext para\n'],
    ['words above a line of equals signs', 'Title ^p\n===\nNext para\n'],
    ['words under a dash rule', 'Title\n---\nPara ^p\nmore\n'],
  ])('%s shows the same block as with Unix line endings', (_, unix) => {
    expect(shown(unix)).toBeTruthy()
    expect(shown(windows(unix))).toBe(shown(unix))
  })
  test('words under a rule are offered as a block of their own', () => {
    const unix = 'Para\n***\nNext para\n'
    const lines = (source: string) => blocksOf(source).map((one) => one.line)
    expect(lines(windows(unix))).toEqual(lines(unix))
  })
  test('naming words right above a rule writes the id where it goes with Unix line endings', () => {
    const unix = 'Some text\n***\nmore words\n'
    const named = namedBlock(windows(unix), 0, () => 'n1')
    expect(named?.source.replace(/\r/g, '')).toBe(namedBlock(unix, 0, () => 'n1')?.source)
  })
})
