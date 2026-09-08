import { describe, expect, test } from 'vitest'
import { INK_TOOLS } from './format'
import { INK_STYLES, outlineOf } from './ink'
import { PEN_ART, PEN_BOX, samplePath, sampleStroke } from './nibs'
import { LEAST_WIDTH, MOST_WIDTH, nibFor } from './pens.svelte'

describe('the drawing of a pen', () => {
  test('there is one for every pen there is', () => {
    expect(Object.keys(PEN_ART).sort()).toEqual([...INK_TOOLS].sort())
  })

  test('each is a barrel, a detail and a nib, and none of them is empty', () => {
    for (const tool of INK_TOOLS) {
      const art = PEN_ART[tool]
      expect(art.barrel.startsWith('M'), tool).toBe(true)
      expect(art.detail.startsWith('M'), tool).toBe(true)
      expect(art.nib.startsWith('M'), tool).toBe(true)
    }
  })

  test('every one of them is drawn inside the box the bar gives it', () => {
    for (const tool of INK_TOOLS) {
      const art = PEN_ART[tool]

      for (const where of ['barrel', 'detail', 'nib'] as const) {
        for (const [seen] of art[where].matchAll(/-?\d+(?:\.\d+)?/g)) {
          expect(Math.abs(Number(seen)), `${tool} ${where}`).toBeLessThanOrEqual(PEN_BOX.height)
        }
      }
    }
  })
})

describe('the line a pen would write', () => {
  test('is written with the pen it is shown for', () => {
    const nib = { ...nibFor('marker', '#ff0000'), size: 7, opacity: 0.4 }
    const stroke = sampleStroke(nib, 200, 60)

    expect(stroke.tool).toBe('marker')
    expect(stroke.color).toBe('#ff0000')
    expect(stroke.size).toBe(7)
    expect(stroke.opacity).toBe(0.4)
  })

  test('stays inside the box it is drawn in, at any width the dial allows', () => {
    // Every pen at every end of the slider, because what breaks this is a fat
    // nib on a turn: perfect-freehand puts the outline of a tapered stroke a
    // little outside its own half-width there, and `sampleStroke` leaves room
    // for exactly that. A line that left the box would be a preview that lied.
    for (const size of [LEAST_WIDTH, 1, 3, 8, 18, MOST_WIDTH]) {
      for (const tool of INK_TOOLS) {
        const ring = outlineOf(sampleStroke({ ...nibFor(tool), size }, 240, 64))

        for (const point of ring) {
          expect(point.x, `${tool} at ${size}`).toBeGreaterThanOrEqual(0)
          expect(point.x, `${tool} at ${size}`).toBeLessThanOrEqual(240)
          expect(point.y, `${tool} at ${size}`).toBeGreaterThanOrEqual(0)
          expect(point.y, `${tool} at ${size}`).toBeLessThanOrEqual(64)
        }
      }
    }
  })

  test('is pressed the way a hand presses: light in, heavy in the middle, light out', () => {
    const points = sampleStroke(nibFor('fountain'), 200, 60).points
    const first = points[0]
    const middle = points[Math.floor(points.length / 2)]
    const last = points[points.length - 1]

    expect(first && middle && last).toBeTruthy()
    expect(middle?.pressure ?? 0).toBeGreaterThan(first?.pressure ?? 1)
    expect(middle?.pressure ?? 0).toBeGreaterThan(last?.pressure ?? 1)
  })

  test('turns enough for a flat nib to show both of its widths', () => {
    // A chisel nib is a ribbon at a fixed angle, so a straight sample would show
    // one width and say nothing. The wave is what makes the two visible.
    const ys = sampleStroke(nibFor('calligraphy'), 200, 60).points.map((one) => one.y)
    const swing = Math.max(...ys) - Math.min(...ys)

    expect(swing).toBeGreaterThan(20)
  })

  test('is a closed path, curved the way the plane paints it', () => {
    const d = samplePath(nibFor('pen'), 200, 60)

    expect(d.startsWith('M')).toBe(true)
    expect(d).toContain('Q')
    expect(d.endsWith('Z')).toBe(true)
  })

  test('is fatter for a fatter pen', () => {
    // How thick the line is where it is thickest, which is the ring's own height
    // in a narrow column rather than the height of the whole wave: the wave
    // flattens as the nib grows, so measuring the box would say the opposite of
    // what a reader sees.
    const thickest = (size: number) => {
      const ring = outlineOf(sampleStroke({ ...nibFor('pen'), size }, 200, 60))
      let most = 0

      for (let x = 20; x < 180; x += 4) {
        const band = ring.filter((one) => one.x >= x && one.x < x + 4).map((one) => one.y)
        if (band.length > 1) most = Math.max(most, Math.max(...band) - Math.min(...band))
      }

      return most
    }

    expect(thickest(20)).toBeGreaterThan(thickest(8))
    expect(thickest(8)).toBeGreaterThan(thickest(2))
  })

  test('a highlighter comes out translucent without anybody asking', () => {
    expect(sampleStroke(nibFor('highlighter'), 200, 60).opacity).toBe(
      INK_STYLES.highlighter.opacity,
    )
  })
})
