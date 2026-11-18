import { describe, expect, test } from 'vitest'
import { sheetFor } from './pages'

describe('the canvas a page is drawn on', () => {
  const PAGE = { width: 800, height: 1000 }

  test('holds every device pixel of the screen it is on', () => {
    expect(sheetFor(PAGE, 16 * 1024 * 1024, 2)).toEqual({
      width: 1600,
      height: 2000,
      drawn: { transform: [2, 0, 0, 2, 0, 0] },
    })
  })

  test('asks pdf.js for no transform at one to one', () => {
    expect(sheetFor(PAGE, 16 * 1024 * 1024, 1)).toEqual({ width: 800, height: 1000, drawn: {} })
  })

  test('draws a little softer past its ceiling rather than asking for more', () => {
    const fit = sheetFor(PAGE, PAGE.width * PAGE.height * 1.5 ** 2, 3)

    expect(fit).toEqual({ width: 1200, height: 1500, drawn: { transform: [1.5, 0, 0, 1.5, 0, 0] } })
  })

  test('though never below one device pixel to the CSS pixel', () => {
    expect(sheetFor(PAGE, 1000, 2)).toEqual({ width: 800, height: 1000, drawn: {} })
  })
})
