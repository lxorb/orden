import { describe, expect, test } from 'vitest'
import { csvValue, sheetSafe } from './csv'

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
test('a link is written by the name the app shows, without the ending of a kind Orden opens', () => {
  for (const [target, name] of [
    ['Plans/Board.canvas', 'Board'],
    ['Read me.md', 'Read me'],
    ['Week.pages', 'Week'],
    ['Talk.chat', 'Talk'],
    ['photo.png', 'photo.png'],
  ] as const) {
    expect(csvValue({ kind: 'link', target })).toBe(name)
  }
})
