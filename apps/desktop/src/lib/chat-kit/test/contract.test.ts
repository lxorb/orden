import { describe, expect, test } from 'vitest'
import { GLYPHS, placeNear } from '../src/api'

describe('the glyphs', () => {
  test('every glyph is one path drawn on the 24 grid', () => {
    for (const [name, path] of Object.entries(GLYPHS)) {
      expect(path, name).toMatch(/^[Mm]/)
    }
    expect(Object.keys(GLYPHS)).toContain('smile')
  })
})
describe('where a float sits beside what opened it', () => {
  const WINDOW = { width: 1000, height: 800 }
  const SIZE = { width: 300, height: 200 }
  test('below it with the start edges lined up, or the end edges when asked', () => {
    const at = { left: 500, top: 100, right: 530, bottom: 120 }
    expect(placeNear(at, SIZE, WINDOW)).toEqual({ left: 500, top: 126 })
    expect(placeNear(at, SIZE, WINDOW, true)).toEqual({ left: 230, top: 126 })
  })
  test('above it when there is no room below, never past the window edges', () => {
    expect(placeNear({ left: 900, top: 700, right: 930, bottom: 720 }, SIZE, WINDOW)).toEqual({
      left: 692,
      top: 494,
    })
    expect(placeNear({ left: -50, top: 10, right: 0, bottom: 20 }, SIZE, WINDOW).left).toBe(8)
  })
})
