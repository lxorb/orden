import { describe, expect, test } from 'vitest'
import { sheetSafe } from './csv'

describe('a cell a spreadsheet would run', () => {
  test('is words', () => {
    for (const cell of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '-x']) {
      expect(sheetSafe(cell)).toBe(`'${cell}`)
    }
  })

  test('a number or plain words stay what they are', () => {
    for (const cell of ['-5', '+1', '-1.5', '12', 'words = more', '2026-11-04', '']) {
      expect(sheetSafe(cell)).toBe(cell)
    }
  })
})
