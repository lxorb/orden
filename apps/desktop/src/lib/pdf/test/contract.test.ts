import { describe, expect, test } from 'vitest'
import { boxOf, PDF_TO_CSS, placesOnPaper, sheetFor, toViewport } from '../src/api'
import { runsOfItems, textOfRuns } from '../src/find'
import { matrixOf } from '../src/highlights'

describe('the words on a paper', () => {
  test('a run that ends its line gets its line break, and the runs join into the text', () => {
    const runs = runsOfItems([
      { str: 'Entropy is', hasEOL: true },
      { str: 'a measure' },
      { width: 4 },
    ])
    expect(runs).toEqual(['Entropy is\n', 'a measure'])
    expect(textOfRuns(runs)).toBe('Entropy is\na measure')
  })

  test('a word broken over two lines by a hyphen is found whole, over the whole span', () => {
    const text = 'the infor-\nmation flows'
    expect(placesOnPaper(text, 'information')).toEqual([{ at: 4, length: 13 }])
    expect(placesOnPaper(text, 'entropy')).toEqual([])
  })
})

describe('where a highlight sits', () => {
  test('a quad lands as the box around its corners on the page as drawn', () => {
    const quad = [10, 20, 30, 20, 30, 5, 10, 5] as const
    expect(boxOf(quad, toViewport(matrixOf([2, 0, 0, 2, 1, 1])))).toEqual({
      left: 21,
      top: 11,
      width: 40,
      height: 30,
    })
  })

  test('a missing matrix value falls back to the identity', () => {
    expect(matrixOf([])).toEqual([1, 0, 0, 1, 0, 0])
  })
})

describe('the size a page is drawn at', () => {
  test('a point is a third larger in CSS pixels', () => {
    expect(PDF_TO_CSS).toBeCloseTo(4 / 3)
  })

  test('a page is drawn sharper up to the screen ratio, and never past the pixel cap', () => {
    expect(sheetFor({ width: 100, height: 100 }, 1_000_000, 2)).toEqual({
      width: 200,
      height: 200,
      drawn: { transform: [2, 0, 0, 2, 0, 0] },
    })
    expect(sheetFor({ width: 100, height: 100 }, 10_000, 2)).toEqual({
      width: 100,
      height: 100,
      drawn: {},
    })
  })
})
