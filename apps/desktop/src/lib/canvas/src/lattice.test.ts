import { describe, expect, test } from 'vitest'
import { GRID } from '../../plane/src/api'
import {
  aimed,
  fading,
  type Fade,
  latticeEvery,
  latticeLayers,
  latticeLevel,
  settled,
  stepped,
} from './lattice'

const THINS_AT = 12
const FILLS_AT = 15

function zooms(): number[] {
  const out: number[] = []
  for (let scale = 8; scale > 0.0002; scale /= 1.03) out.push(scale)
  return out
}

describe('the level a zoom asks for', () => {
  test('is every point of the grid when there is room for every point', () => {
    expect(latticeLevel(1)).toBe(0)
    expect(latticeLevel(2)).toBe(0)
    expect(latticeLevel(4)).toBe(0)
  })

  test('thins as its points close to the floor, and not before', () => {
    expect(latticeLevel(0.61, 0)).toBe(0)
    expect(latticeLevel(0.6, 0)).toBe(0)
    expect(latticeLevel(0.599, 0)).toBe(1)

    expect(latticeLevel(0.3, 1)).toBe(1)
    expect(latticeLevel(0.299, 1)).toBe(2)
  })

  test('comes back only once there is comfortably room again', () => {
    expect(latticeLevel(0.6, 1)).toBe(1)
    expect(latticeLevel(0.74, 1)).toBe(1)
    expect(latticeLevel(0.75, 1)).toBe(0)

    expect(latticeLevel(0.374, 2)).toBe(2)
    expect(latticeLevel(0.375, 2)).toBe(1)
  })

  test('does not flap for a zoom hovering on a threshold', () => {
    let level = latticeLevel(0.62)
    expect(level).toBe(0)

    for (const scale of [0.6, 0.599, 0.601, 0.6, 0.62, 0.599, 0.7, 0.61]) {
      level = latticeLevel(scale, level)
    }
    expect(level).toBe(1)

    level = latticeLevel(0.8, level)
    expect(level).toBe(0)
    for (const scale of [0.76, 0.9, 0.75, 0.8]) level = latticeLevel(scale, level)
    expect(level).toBe(0)
  })

  test('is settled: asking again of the answer gives the answer back', () => {
    for (const scale of zooms()) {
      for (const held of [0, 1, 2, 3, 4, 8]) {
        const once = latticeLevel(scale, held)
        expect(latticeLevel(scale, once), `${scale} from ${held}`).toBe(once)
      }
    }
  })

  test('only ever coarsens as the plane goes out', () => {
    let level = latticeLevel(4)
    let coarsest = level

    for (const scale of zooms()) {
      level = latticeLevel(scale, level)
      expect(level, String(scale)).toBeGreaterThanOrEqual(coarsest)
      coarsest = level
    }
  })

  test('takes a level that is not one, and a zoom that is not a zoom, in its stride', () => {
    expect(latticeLevel(1, -5)).toBe(0)
    expect(latticeLevel(1, Number.NaN)).toBe(0)
    expect(latticeLevel(1, 2.4)).toBe(0)
    expect(latticeLevel(0, 3)).toBe(3)
    expect(latticeLevel(-1, 3)).toBe(3)
    expect(latticeLevel(Number.NaN, 3)).toBe(3)
    expect(latticeLevel(Number.POSITIVE_INFINITY, 3)).toBe(3)
  })
})

describe('the lattice the levels are cut from', () => {
  test('doubles its spacing every level, starting at the grid itself', () => {
    expect(latticeEvery(0)).toBe(GRID)
    expect(latticeEvery(1)).toBe(2 * GRID)
    expect(latticeEvery(4)).toBe(16 * GRID)
  })

  test("keeps every coarser level's points inside the finer one's", () => {
    for (let level = 0; level < 8; level++) {
      const fine = latticeEvery(level)
      const coarse = latticeEvery(level + 1)

      expect(coarse % fine).toBe(0)

      const points = new Set<number>()
      for (let at = -40 * fine; at <= 40 * fine; at += fine) points.add(at)
      for (let at = -40 * fine; at <= 40 * fine; at += coarse) {
        expect(points.has(at), `${at} of ${coarse} in ${fine}`).toBe(true)
      }
    }
  })

  test('never draws more points than the grid, however deep the fade', () => {
    for (const at of [0, 0.001, 0.5, 1, 1.5, 4, 7.25]) {
      for (const layer of latticeLayers(at, 0.5)) {
        expect(layer.every, String(at)).toBeGreaterThanOrEqual(GRID)
      }
    }
  })

  test('keeps the points on screen inside a comfortable band', () => {
    let level = latticeLevel(8)

    for (const scale of zooms()) {
      level = latticeLevel(scale, level)
      const step = latticeEvery(level) * scale

      expect(step, String(scale)).toBeGreaterThanOrEqual(THINS_AT)
      if (level > 0) expect(step, String(scale)).toBeLessThan(2 * FILLS_AT)
    }
  })
})

describe('the fade between levels', () => {
  const MS = 200

  function through(fade: Fade, wound: number, frame = 16): Fade {
    let out = fade
    for (let gone = 0; gone < wound; gone += frame) out = stepped(out, frame, MS)
    return out
  }

  test('stands still at a level until something asks it to move', () => {
    const still = settled(2)
    expect(still.at).toBe(2)
    expect(fading(still)).toBe(false)
    expect(stepped(still, 16, MS)).toBe(still)
  })

  test('sets off when the level changes and arrives at the far end', () => {
    const going = aimed(settled(2), 3)
    expect(going.at).toBe(2)
    expect(fading(going)).toBe(true)

    const half = through(going, MS / 2)
    expect(half.at).toBeGreaterThan(2)
    expect(half.at).toBeLessThan(3)

    const done = through(going, MS)
    expect(done.at).toBe(3)
    expect(fading(done)).toBe(false)
  })

  test('is a function of time and never of the zoom', () => {
    const half = through(aimed(settled(1), 2), MS / 2)
    for (const scale of [1, 0.5, 0.31, 0.04]) {
      const layers = latticeLayers(half.at, scale)
      expect(layers[1]?.showing, String(scale)).toBeCloseTo(2 - half.at, 12)
    }
  })

  test('moves one way only, and eases as it lands', () => {
    let fade = aimed(settled(3), 2)
    let last = fade.at

    for (let gone = 0; gone < MS; gone += 8) {
      fade = stepped(fade, 8, MS)
      expect(fade.at).toBeLessThanOrEqual(last)
      last = fade.at
    }
    expect(fade.at).toBe(2)

    expect(through(aimed(settled(3), 2), MS / 2).at).toBeLessThan(2.5)
  })

  test('retargets the fade that is running rather than queueing behind it', () => {
    const out = through(aimed(settled(2), 3), MS / 2)
    const back = aimed(out, 2)

    expect(back.from).toBe(out.at)
    expect(back.at).toBe(out.at)
    expect(back.to).toBe(2)
    expect(back.gone).toBe(0)

    expect(through(back, MS).at).toBe(2)
  })

  test('a second change replaces the first: there is no queue to work through', () => {
    const going = aimed(aimed(settled(2), 3), 5)
    expect(going.to).toBe(5)
    expect(through(going, MS).at).toBe(5)
  })

  test('aiming where it is already going changes nothing', () => {
    const going = aimed(settled(2), 3)
    expect(aimed(going, 3)).toBe(going)
  })

  test('arrives at once for a reader who has asked for no movement', () => {
    const going = aimed(settled(2), 4)
    const done = stepped(going, 16, 0)
    expect(done.at).toBe(4)
    expect(fading(done)).toBe(false)
  })

  test('crosses several levels by passing through them, not by jumping', () => {
    let fade = aimed(settled(0), 4)
    const seen = new Set<number>()

    for (let gone = 0; gone < MS; gone += 4) {
      fade = stepped(fade, 4, MS)
      for (const layer of latticeLayers(fade.at, 0.05)) seen.add(layer.every)
    }

    for (const level of [0, 1, 2, 3, 4]) {
      expect(seen.has(latticeEvery(level)), `level ${level}`).toBe(true)
    }
  })
})

describe('the tiles the pattern draws', () => {
  test('are one when it is settled', () => {
    expect(latticeLayers(0, 1)).toEqual([{ every: GRID, step: GRID, showing: 1 }])
    expect(latticeLayers(2, 0.25)).toEqual([{ every: 4 * GRID, step: 4 * GRID * 0.25, showing: 1 }])
  })

  test('are two while it is moving: the coarser whole, the finer fading over it', () => {
    const layers = latticeLayers(1.4, 0.5)
    expect(layers).toHaveLength(2)

    expect(layers[0]!.every).toBe(4 * GRID)
    expect(layers[0]!.showing).toBe(1)
    expect(layers[1]!.every).toBe(2 * GRID)
    expect(layers[1]!.showing).toBeCloseTo(0.6, 12)
    expect(layers[0]!.every).toBe(2 * layers[1]!.every)
  })

  test('are a step in pixels, which is what a repeating tile is sized by', () => {
    expect(latticeLayers(1, 0.5)[0]!.step).toBe(2 * GRID * 0.5)
    expect(latticeLayers(3, 0.1)[0]!.step).toBeCloseTo(8 * GRID * 0.1, 12)
  })

  test('drop the second the moment it is too faint to be worth a paint', () => {
    expect(latticeLayers(2.999, 1)).toHaveLength(1)
    expect(latticeLayers(2.98, 1)).toHaveLength(2)
  })

  test('are nothing at all for a zoom that is not a zoom', () => {
    expect(latticeLayers(1, 0)).toEqual([])
    expect(latticeLayers(1, -1)).toEqual([])
    expect(latticeLayers(Number.NaN, 1)).toEqual([])
  })
})
