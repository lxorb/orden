import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  AA,
  alphaFor,
  CONTENT_LEVELS,
  CopyButton,
  hexOf,
  Hint,
  inkFor,
  layered,
  linkOf,
  luminance,
  over,
  percent,
  ratio,
  rgbOf,
  Select,
  Sheet,
  Switch,
} from '../src/api'
import { putsAway } from '../src/sheet-pull'

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('nothing under src reaches past the platform, theme and ui-kit apis', () => {
    const reaching = readdirSync(SRC)
      .filter((name) => !name.includes('.test.'))
      .flatMap((name) => {
        const text = readFileSync(join(SRC, name), 'utf8')
        return [...text.matchAll(/'(\.\.\/[^']*)'/g)]
          .map((found) => found[1] ?? '')
          .filter((spec) => !/^\.\.\/\.\.\/(?:platform|theme|ui-kit)\/src\/api$/.test(spec))
          .map((spec) => `${name}: ${spec}`)
      })
    expect(reaching).toEqual([])
  })

  test('the controls are components', () => {
    for (const one of [Sheet, Select, Switch, Hint, CopyButton]) expect(typeof one).toBe('function')
  })
})

describe('legibility', () => {
  test('a colour is read from hex or rgb and written back as hex', () => {
    expect(rgbOf('#fff')).toEqual([255, 255, 255])
    expect(rgbOf('rgb(10, 20, 30)')).toEqual([10, 20, 30])
    expect(rgbOf('rgba(300 -5 7 / 0.5)')).toEqual([255, 0, 7])
    expect(rgbOf('red')).toBeNull()
    expect(hexOf([10, 20, 30])).toBe('#0a141e')
  })

  test('contrast is symmetric, black on white is 21, and the readable ink is chosen', () => {
    const black: readonly [number, number, number] = [0, 0, 0]
    const white: readonly [number, number, number] = [255, 255, 255]
    const grey: readonly [number, number, number] = [128, 128, 128]
    expect(luminance(white)).toBeCloseTo(1, 5)
    expect(ratio(black, white)).toBeCloseTo(21, 3)
    expect(ratio(white, black)).toBe(ratio(black, white))
    expect(ratio(grey, white)).toBeLessThan(AA)
    expect(inkFor(white, [grey, black])).toEqual(black)
    expect(over(white, 0.5, black)).toEqual([127.5, 127.5, 127.5])
    expect(linkOf([0, 0, 255], black)).toEqual(over([0, 0, 255], 0.7, black))
  })

  test('a content level is an alpha, layers add up to the whole, and percent rounds', () => {
    expect(CONTENT_LEVELS).toEqual(['opaque', 'tinted', 'clear'])
    expect(alphaFor('opaque', 0.3)).toBe(1)
    expect(alphaFor('clear', 0.3)).toBe(0.3)
    expect(layered(1, 1)).toBe(1)
    expect(layered(0.75, 0.5)).toBe(0.5)
    expect(percent(0.456)).toBe('46%')
  })
})

describe('a sheet pulled down', () => {
  test('goes away on a flick or past a quarter of its height, never on a twitch', () => {
    expect(putsAway(5, 800, 2)).toBe(false)
    expect(putsAway(30, 800, 0.9)).toBe(true)
    expect(putsAway(119, 800, 0)).toBe(false)
    expect(putsAway(120, 800, 0)).toBe(true)
    expect(putsAway(60, 200, 0)).toBe(true)
  })
})
