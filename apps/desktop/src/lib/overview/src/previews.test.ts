import { expect, test } from 'vitest'
import { TAB_KINDS } from '../../workspace/tab-kinds'
import { readingFrom, screenText } from './previews'

test('a note reads from the start of the line it was left at, as it is now', () => {
  const doc = '# Title\n\nfirst\nsecond line\nthird'
  expect(readingFrom(doc, doc.indexOf('cond'), 100)).toBe('second line\nthird')
  expect(readingFrom(doc, undefined, 7)).toBe('# Title')
  expect(readingFrom(doc, 99999, 10)).toBe('third')
})

test('a terminal is the last lines of its screen, its colours and the cursor taken out', () => {
  const screen = '\x1b[32mok\x1b[0m one\r\ntwo\r\n\x1b]0;title\x07three\r\n\r\n'
  expect(screenText(screen, 2)).toBe('two\nthree')
  expect(screenText(screen, 10)).toBe('ok one\ntwo\nthree')
})

test('every kind says how its window is drawn, and only a page is a photograph', () => {
  const ways = Object.entries(TAB_KINDS).map(([kind, traits]) => [kind, traits.preview])
  expect(ways.every(([, way]) => way)).toBe(true)
  expect(ways.filter(([, way]) => way === 'photograph').map(([kind]) => kind)).toEqual(['web'])
  expect(TAB_KINDS.note.preview).toBe('reading')
  expect(TAB_KINDS.terminal.preview).toBe('scrollback')
})
