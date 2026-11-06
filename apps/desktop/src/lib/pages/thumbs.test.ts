import { describe, expect, test } from 'vitest'
import { shelvesOf, shownOf } from './thumbs'

const A4 = { width: 794, height: 1123 }
const WIDE = { width: 1123, height: 794 }
const SHELF = { least: 88, gap: 8, edge: 1 }

describe('the page list of a long page note', () => {
  test('lays its thumbnails out as the grid does, two to a row in a sidebar', () => {
    const shelves = shelvesOf([A4, WIDE, WIDE, WIDE, A4], 192, SHELF)

    expect(shelves.columns).toBe(2)
    const tall = 90 * (1123 / 794) + 2
    const flat = 90 * (794 / 1123) + 2
    expect(shelves.heights[0]).toBeCloseTo(tall)
    expect(shelves.heights[1]).toBeCloseTo(flat)
    expect(shelves.heights[2]).toBeCloseTo(tall)
    const tops = [0, tall + 8, tall + flat + 16]
    expect(shelves.tops).toHaveLength(tops.length)
    shelves.tops.forEach((top, at) => expect(top).toBeCloseTo(tops[at] ?? Number.NaN))
    expect(shelves.total).toBeCloseTo(2 * tall + flat + 16)
  })

  test('mounts only the rows near the screen, however many pages there are', () => {
    const sheets = Array.from({ length: 5000 }, () => A4)
    const shelves = shelvesOf(sheets, 192, SHELF)

    const top = shownOf(shelves, sheets.length, 0, 600)
    expect(top.from).toBe(0)
    expect(top.above).toBe(0)
    expect(top.to).toBeLessThan(24)

    const deep = shownOf(shelves, sheets.length, 200_000, 600)
    expect(deep.to - deep.from).toBeLessThan(24)
    const row = deep.from / shelves.columns
    expect(deep.above).toBe(shelves.tops[row])
    expect(deep.above).toBeLessThanOrEqual(200_000 - 300)
    expect(deep.above).toBeGreaterThan(200_000 - 300 - 200)
    const last = (deep.to - 1) / shelves.columns
    const end = (shelves.tops[Math.floor(last)] ?? 0) + (shelves.heights[Math.floor(last)] ?? 0)
    expect(end).toBeGreaterThanOrEqual(200_000 + 900)
    expect(deep.above + deep.below).toBeLessThan(shelves.total)

    const bottom = shownOf(shelves, sheets.length, shelves.total, 600)
    expect(bottom.to).toBe(5000)
    expect(bottom.below).toBe(0)
  })

  test('keeps every page on its own row of the grid where the list is narrow', () => {
    const shelves = shelvesOf([A4, A4, A4], 60, SHELF)
    expect(shelves.columns).toBe(1)
    expect(shownOf(shelves, 3, 0, 10_000)).toMatchObject({ from: 0, to: 3, above: 0, below: 0 })
  })

  test('has nothing to show for no pages', () => {
    expect(shownOf(shelvesOf([], 192, SHELF), 0, 0, 600)).toEqual({
      from: 0,
      to: 0,
      above: 0,
      below: 0,
    })
  })
})
