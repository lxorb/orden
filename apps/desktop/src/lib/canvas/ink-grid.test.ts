import { describe, expect, test } from 'vitest'
import type { InkStroke } from './format'
import type { Box } from './geometry'
import { strokeBox } from './ink'
import { InkGrid } from './ink-grid'

function stroke(id: string, x: number, y: number, wide = 20, tall = 8, size = 3): InkStroke {
  return {
    id,
    tool: 'pen',
    color: 'ink',
    size,
    points: [
      { x, y, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
      { x: x + wide, y: y + tall, pressure: 0.5, tiltX: 0, tiltY: 0, t: 10 },
    ],
  }
}

function meets(one: Box, other: Box): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  )
}

function walked(strokes: readonly InkStroke[], box: Box): string[] {
  return strokes
    .filter((one) => meets(strokeBox(one), box))
    .map((one) => one.id)
    .sort()
}

function ids(strokes: readonly InkStroke[]): string[] {
  return strokes.map((one) => one.id).sort()
}

function numbers(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31
    return state / 2 ** 31
  }
}

describe('which strokes are near a part of the plane', () => {
  test('answers what a walk of every stroke answers, each stroke once', () => {
    const next = numbers(7)
    const strokes: InkStroke[] = []
    for (let one = 0; one < 600; one++) {
      const long = one % 37 === 0
      strokes.push(
        stroke(
          `s${one}`,
          next() * 6000 - 3000,
          next() * 6000 - 3000,
          long ? 1500 : 30,
          long ? 900 : 10,
        ),
      )
    }

    const grid = new InkGrid()
    for (const one of strokes) grid.add(one)

    for (let ask = 0; ask < 80; ask++) {
      const box = {
        x: next() * 7000 - 3500,
        y: next() * 7000 - 3500,
        width: 5 + next() * 2000,
        height: 5 + next() * 2000,
      }
      const found = grid.near(box)

      expect(ids(found)).toEqual(walked(strokes, box))
      expect(new Set(found).size).toBe(found.length)
    }
  })

  test('forgets a stroke taken away, from every cell it was under', () => {
    const kept = stroke('kept', 10, 10)
    const gone = stroke('gone', 0, 0, 2000, 40)
    const grid = new InkGrid()
    grid.add(kept)
    grid.add(gone)

    grid.remove(gone)

    expect(ids(grid.near({ x: -100, y: -100, width: 4000, height: 400 }))).toEqual(['kept'])
    expect(grid.near({ x: 1500, y: 0, width: 100, height: 100 })).toEqual([])
  })

  test('is asked about a corner of the plane without being walked whole', () => {
    const grid = new InkGrid()
    for (let one = 0; one < 10_000; one++) grid.add(stroke(`far${one}`, 50_000 + one * 3, 50_000))
    grid.add(stroke('here', 5, 5))

    expect(ids(grid.near({ x: 0, y: 0, width: 100, height: 100 }))).toEqual(['here'])
  })
})

describe('a stroke stretched across much of the plane', () => {
  const huge = stroke('huge', -4e8, -4e8, 8e8, 8e8)

  test('is filed, found and let go at once, not cell by cell', () => {
    const grid = new InkGrid()
    const near = stroke('near', 10, 10)
    const started = performance.now()
    grid.add(huge)
    grid.add(near)

    expect(ids(grid.near({ x: 0, y: 0, width: 256, height: 256 }))).toEqual(['huge', 'near'])
    expect(ids(grid.near({ x: 5e8, y: 5e8, width: 256, height: 256 }))).toEqual([])

    grid.remove(huge)
    grid.remove(stroke('never', -4e8, 0, 8e8, 1))
    expect(ids(grid.near({ x: 0, y: 0, width: 256, height: 256 }))).toEqual(['near'])
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test('and a part of the plane asked about that is as wide finds each stroke once', () => {
    const grid = new InkGrid()
    const strokes = [huge, stroke('a', 0, 0, 600, 600), stroke('b', 9e6, 9e6)]
    for (const one of strokes) grid.add(one)
    const wide = { x: -1e7, y: -1e7, width: 2e7, height: 2e7 }

    expect(ids(grid.near(wide))).toEqual(walked(strokes, wide))
  })
})
