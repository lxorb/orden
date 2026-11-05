import { describe, expect, test } from 'vitest'

import { groundOf, rounded } from './underlay'

const CARD = { x: 10, y: 50, width: 400, height: 300 }

describe('the ground behind a page drawn under the app', () => {
  test('is the painter less the page, with the card corner at its bottom', () => {
    const page = { x: 10, y: 90, width: 400, height: 260, corner: 12 }
    expect(groundOf(CARD, 12, [page])).toBe(
      `path(evenodd, "${rounded({ x: 0, y: 0, width: 400, height: 300 }, 12, false)} ${rounded(
        { x: 0, y: 40, width: 400, height: 260 },
        12,
        true,
      )}")`,
    )
  })

  test('is nothing to change for a painter with no page inside it', () => {
    const elsewhere = { x: 500, y: 90, width: 300, height: 260, corner: 12 }
    expect(groundOf(CARD, 12, [elsewhere])).toBeNull()
    expect(groundOf(CARD, 12, [])).toBeNull()
  })

  test('leaves out every page inside it', () => {
    const left = { x: 10, y: 90, width: 190, height: 260, corner: 0 }
    const right = { x: 210, y: 90, width: 200, height: 260, corner: 0 }
    const shape = groundOf(CARD, 0, [left, right])
    expect(shape?.match(/M/g)).toHaveLength(3)
  })
})

describe('a rounded rectangle', () => {
  test('is square where it has no corner', () => {
    expect(rounded({ x: 1, y: 2, width: 3, height: 4 }, 0, false)).toBe('M1 2H4V6H1V2Z')
  })

  test('rounds only its bottom where asked', () => {
    expect(rounded({ x: 0, y: 0, width: 100, height: 50 }, 10, true)).toBe(
      'M0 0H100V40A10 10 0 0 1 90 50H10A10 10 0 0 1 0 40V0Z',
    )
  })

  test('never rounds more than half of its shorter side', () => {
    expect(rounded({ x: 0, y: 0, width: 10, height: 10 }, 40, true)).toContain('A5 5')
  })
})
