import { describe, expect, test } from 'vitest'
import { fieldAlone } from './bar-rows'

/** The bar's own numbers: five glyphs of 28 with the site's margin of 4, a field whose
 *  basis is 128, and gaps of 4. One line takes 28 * 5 + 4 + 128 + 4 * 5 = 292. */
const GLYPHS = [28, 28, 28, 32, 28]

describe('whether the address field takes a line of its own (#1118)', () => {
  test('everything on one line where it fits, to the pixel', () => {
    expect(fieldAlone(292, GLYPHS, 128, 4)).toBe(false)
    expect(fieldAlone(600, GLYPHS, 128, 4)).toBe(false)
  })

  test('the field alone under the glyphs the moment it does not', () => {
    expect(fieldAlone(291, GLYPHS, 128, 4)).toBe(true)
    expect(fieldAlone(200, GLYPHS, 128, 4)).toBe(true)
  })

  test('a glyph that arrives counts, with its gap', () => {
    expect(fieldAlone(300, GLYPHS, 128, 4)).toBe(false)
    expect(fieldAlone(300, [...GLYPHS, 28], 128, 4)).toBe(true)
  })

  test('half a pixel of laying out in fractions is not too narrow', () => {
    expect(fieldAlone(291.6, GLYPHS, 128, 4)).toBe(false)
  })
})
