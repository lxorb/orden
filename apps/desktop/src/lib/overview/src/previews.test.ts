import { expect, test } from 'vitest'
import { TAB_KINDS } from '../../tab-kinds/src/api'
import { readingFrom } from './previews'

test('a note reads from the start of the line it was left at, as it is now', () => {
  const doc = '# Title\n\nfirst\nsecond line\nthird'
  expect(readingFrom(doc, doc.indexOf('cond'), 100)).toBe('second line\nthird')
  expect(readingFrom(doc, undefined, 1)).toBe('# Title')
  expect(readingFrom(doc, 99999, 10)).toBe('third')
})
test('a window reads no more lines of a long note than it shows, nor overlong ones whole', () => {
  const doc = Array.from({ length: 2000 }, (_, i) => `line ${i} of words`).join('\n')
  const read = readingFrom(doc, undefined, 27)
  expect(read.split('\n')).toHaveLength(27)
  expect(read.startsWith('line 0 of words\nline 1')).toBe(true)
  const prose = 'word '.repeat(20000)
  expect(readingFrom(prose, undefined, 27).length).toBeLessThanOrEqual(27 * 120)
})
test('every kind says how its window is drawn, and only a page is a photograph', () => {
  const ways = Object.entries(TAB_KINDS).map(([kind, traits]) => [kind, traits.preview])
  expect(ways.every(([, way]) => way)).toBe(true)
  expect(ways.filter(([, way]) => way === 'photograph').map(([kind]) => kind)).toEqual(['web'])
  expect(TAB_KINDS.note.preview).toBe('reading')
  expect(TAB_KINDS.terminal.preview).toBe('scrollback')
})
