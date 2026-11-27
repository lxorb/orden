import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

type Bar = [number, number, number, number]
interface Icons {
  T: number
  GAP: number
  R: number
  WIDE: number
  SAFE: number
  SCALE: number
  APPS: Record<string, { bars: Bar[]; ground: [string, string] | null }>
  densities: string[]
  placed: (bars: Bar[]) => Bar[]
  layers: (app: string, density: string) => Record<string, Uint8Array>
  resOf: (root: string, app: string) => string
}
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const icons = (await import('../../../scripts/app-icons.mjs')) as unknown as Icons
const { T, GAP, WIDE, SAFE, APPS } = icons
const names = Object.keys(APPS)
const apart = (one: Bar, other: Bar) =>
  Math.max(one[0] - other[2], other[0] - one[2], one[1] - other[3], other[1] - one[3])
const mark = readFileSync(join(ROOT, 'scripts/mark.mjs'), 'utf8')
const said = (name: string) => Number(new RegExp(String.raw`const ${name} = (\d+)`).exec(mark)?.[1])
describe('the launcher icons of Orden Notes, Todo, Chat and Track (#2286)', () => {
  test('are drawn with the bar of Orden’s own mark: its thickness, its gap and its corner', () => {
    expect(names).toEqual(['notes', 'todo', 'chat', 'track'])
    expect([T, GAP, icons.R]).toEqual([said('T'), said('GAP'), said('R')])
    expect(WIDE).toBe(said('B') - said('A'))
  })
  test('have exactly four bars each, as wide together as the mark', () => {
    for (const name of names) {
      const bars = APPS[name]?.bars ?? []
      expect(bars, name).toHaveLength(4)
      expect(Math.max(...bars.map((bar) => bar[2])) - Math.min(...bars.map((bar) => bar[0])), name).toBe(WIDE)
      for (const bar of bars) expect(Math.min(bar[2] - bar[0], bar[3] - bar[1]), name).toBe(T)
    }
  })
  test('keep the mark’s gap wherever two bars meet, and never touch', () => {
    for (const name of names) {
      const bars = APPS[name]?.bars ?? []
      let meeting = 0
      for (const [at, one] of bars.entries()) {
        for (const other of bars.slice(at + 1)) {
          const between = apart(one, other)
          expect(between, name).toBeGreaterThan(0)
          if (between > T / 2) continue
          meeting++
          expect(between, name).toBe(GAP)
        }
      }
      expect(meeting, name).toBeGreaterThanOrEqual(2)
    }
  })
  test('stay inside the circle no launcher cuts into', () => {
    for (const name of names) {
      for (const [x0, y0, x1, y1] of icons.placed(APPS[name]?.bars ?? [])) {
        for (const [x, y] of [
          [x0, y0],
          [x1, y0],
          [x0, y1],
          [x1, y1],
        ] as const) {
          expect(Math.hypot(x - 512, y - 512), name).toBeLessThan(SAFE)
        }
      }
    }
  })
  test('are in the project as every layer and size Android asks for, and are what the script draws', () => {
    for (const name of names) {
      for (const density of icons.densities) {
        const dir = join(icons.resOf(ROOT, name), `mipmap-${density}`)
        expect(readdirSync(dir).sort(), `${name} ${density}`).toEqual([
          'ic_launcher.png',
          'ic_launcher_background.png',
          'ic_launcher_foreground.png',
          'ic_launcher_monochrome.png',
          'ic_launcher_round.png',
        ])
      }
      for (const [file, bytes] of Object.entries(icons.layers(name, 'mdpi'))) {
        const kept = readFileSync(join(icons.resOf(ROOT, name), 'mipmap-mdpi', file))
        expect(Buffer.from(bytes).equals(kept), `${name} ${file}`).toBe(true)
      }
    }
  })
  test('draw a bar equally thick on all four, Orden Notes included', () => {
    const thick = names.map((name) =>
      icons.placed(APPS[name]?.bars ?? []).map((bar) => Math.min(bar[2] - bar[0], bar[3] - bar[1]).toFixed(3)),
    )
    expect(new Set(thick.flat()).size).toBe(1)
    expect(Number(thick[0]?.[0])).toBeCloseTo(T * icons.SCALE, 3)
  })
  test('give Orden Notes the mark itself, bar for bar, only larger', () => {
    const [a, b] = [said('A'), said('B')]
    const m = b - T
    const own = [
      [a, a, m - GAP, a + T],
      [m, a, b, m - GAP],
      [a + T + GAP, m, b, b],
      [a, a + T + GAP, a + T, b],
    ].map((bar) => bar.map((value) => value - a))
    expect(APPS.notes?.bars).toEqual(own)
    expect(APPS.notes?.ground).toBeNull()
  })
  test('leave the whole Orden, which is released, on the icon it has', () => {
    const res = icons.resOf(ROOT, 'orden')
    const own = existsSync(res) ? readdirSync(res).filter((one) => one.startsWith('mipmap')) : []
    expect(own).toEqual([])
  })
})
