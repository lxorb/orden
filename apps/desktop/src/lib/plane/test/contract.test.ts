import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { movedBy, removed, withText } from '../src/edits'
import { overlaps, rectBetween, snapped } from '../src/geometry'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')

describe('the module stands on its own', () => {
  test('draws a plane for whoever asks through the canvas.pictures port, from what its api names', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    expect(api).toMatch(/\bplaneSvg\b/)
    expect(api).toMatch(/\bdrawingOf\b/)
  })
})

const card = (id: string, x = 0) => ({
  id,
  type: 'text' as const,
  text: id,
  x,
  y: 0,
  width: 100,
  height: 40,
})

const plane = () => ({
  nodes: [card('a'), card('b', 200)],
  edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
  ink: [],
  at: {},
  gone: {},
})

describe('an edit of a plane', () => {
  test('moves only the cards picked, and nothing when it moves no way', () => {
    const before = plane()
    const after = movedBy(before, ['a'], 20, 0)
    expect(after.nodes.map((one) => one.x)).toEqual([20, 200])
    expect(movedBy(before, ['a'], 0, 0)).toBe(before)
  })

  test('takes a card away with the arrows that reach it', () => {
    const after = removed(plane(), ['b'])
    expect(after.nodes.map((one) => one.id)).toEqual(['a'])
    expect(after.edges).toEqual([])
  })

  test('writes words into a card and hands the same plane back when they are the same', () => {
    const before = plane()
    expect(withText(before, 'a', 'new').nodes[0]).toMatchObject({ text: 'new' })
    expect(withText(before, 'a', 'a')).toBe(before)
    expect(withText(before, 'gone', 'x')).toBe(before)
  })
})

describe('the geometry of a plane', () => {
  test('lands on the grid and boxes two points in either order', () => {
    expect([snapped(9), snapped(11), snapped(-11)]).toEqual([0, 20, -20])
    expect(rectBetween({ x: 30, y: 40 }, { x: 10, y: 0 })).toEqual({
      x: 10,
      y: 0,
      width: 20,
      height: 40,
    })
  })

  test('counts boxes that only touch as apart', () => {
    const one = { x: 0, y: 0, width: 10, height: 10 }
    expect(overlaps(one, { x: 5, y: 5, width: 10, height: 10 })).toBe(true)
    expect(overlaps(one, { x: 10, y: 0, width: 10, height: 10 })).toBe(false)
  })
})
