import { expect, test } from 'vitest'
import { screenText } from './previews'

test('a terminal is the last lines of its screen, its colours and the cursor taken out', () => {
  const screen = '\x1b[32mok\x1b[0m one\r\ntwo\r\n\x1b]0;title\x07three\r\n\r\n'
  expect(screenText(screen, 2)).toBe('two\nthree')
  expect(screenText(screen, 10)).toBe('ok one\ntwo\nthree')
})
