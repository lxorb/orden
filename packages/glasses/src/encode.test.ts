import { describe, expect, test } from 'vitest'
import { ditherToLevels, packGray4, quantise, type Tile, unpackGray4 } from './encode'
import { GREY_LEVELS, PANEL_HEIGHT, PANEL_WIDTH, WHITE } from './panel'

/** A page's worth of levels with something in every one of them: a gradient
 *  across, a few bright rows, and the rest dark - which is what a page of text
 *  on this panel actually is. */
function synthetic(width = PANEL_WIDTH, height = PANEL_HEIGHT): Tile {
  const levels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      levels[y * width + x] = y % 21 < 12 ? (x + y) % GREY_LEVELS : 0
    }
  }

  return { width, height, levels }
}

describe('the four bit buffer', () => {
  test('is half a byte a pixel', () => {
    const tile = synthetic()
    expect(packGray4(tile).length).toBe((PANEL_WIDTH * PANEL_HEIGHT) / 2)
  })

  test('survives a round trip over a whole page', () => {
    const tile = synthetic()
    const back = unpackGray4(packGray4(tile), tile.width, tile.height)

    expect(back.width).toBe(tile.width)
    expect(back.height).toBe(tile.height)
    expect(back.levels).toEqual(tile.levels)
  })

  test('survives a round trip over one container’s tile', () => {
    // The size the glasses actually take: an image container is at most 288 by
    // 144, so a page is four of these.
    const tile = synthetic(288, 144)
    expect(packGray4(tile).length).toBe(20736)
    expect(unpackGray4(packGray4(tile), 288, 144).levels).toEqual(tile.levels)
  })

  test('puts the left pixel in the high nibble', () => {
    const bytes = packGray4({ width: 2, height: 1, levels: new Uint8Array([WHITE, 1]) })
    expect(bytes).toEqual(new Uint8Array([0xf1]))
  })

  test('refuses what it cannot pack', () => {
    expect(() => packGray4({ width: 3, height: 1, levels: new Uint8Array(3) })).toThrow(
      /padding rule/,
    )
    expect(() => packGray4({ width: 4, height: 2, levels: new Uint8Array(4) })).toThrow(/wants 8/)
    expect(() => packGray4({ width: 0, height: 1, levels: new Uint8Array() })).toThrow(/no size/)
    expect(() => unpackGray4(new Uint8Array(3), 4, 2)).toThrow(/not a 4x2 tile/)
  })

  test('packs an empty container as nothing lit', () => {
    const dark = { width: 4, height: 2, levels: new Uint8Array(8) }
    expect(packGray4(dark)).toEqual(new Uint8Array(4))
    expect(unpackGray4(packGray4(dark), 4, 2).levels).toEqual(dark.levels)
  })
})

describe('a channel as a level', () => {
  test('spans both ends', () => {
    expect(quantise(0)).toBe(0)
    expect(quantise(255)).toBe(WHITE)
    expect(quantise(17)).toBe(1)
    expect(quantise(136)).toBe(8)
  })

  test('stays on the panel whatever arrives', () => {
    expect(quantise(-40)).toBe(0)
    expect(quantise(400)).toBe(WHITE)
  })
})

describe('a picture in sixteen greys', () => {
  test('keeps the tone it was given', () => {
    const flat = new Uint8Array(64).fill(120)
    const levels = ditherToLevels(flat, 8, 8)
    const mean = [...levels].reduce((sum, one) => sum + one, 0) / levels.length

    // 120 of 255 is a hair over seven fifteenths; the pattern has to average
    // there rather than land on one side of it.
    expect(mean).toBeGreaterThan(6.6)
    expect(mean).toBeLessThan(7.6)
  })

  test('breaks a flat tone into more than one level', () => {
    // Which is the point: a photograph quantised straight comes out in bands.
    const levels = ditherToLevels(new Uint8Array(64).fill(120), 8, 8)
    expect(new Set(levels).size).toBeGreaterThan(1)
  })

  test('leaves black black and white white', () => {
    expect([...ditherToLevels(new Uint8Array(16).fill(0), 4, 4)]).toEqual(Array(16).fill(0))
    expect([...ditherToLevels(new Uint8Array(16).fill(255), 4, 4)]).toEqual(Array(16).fill(WHITE))
  })
})
