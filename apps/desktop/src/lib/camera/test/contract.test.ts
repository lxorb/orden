import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { graphPoint, screenPoint, wheelPixels, zoomed } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

describe('the module stands on its own', () => {
  test('imports nothing at all, so the published site script carries it without a barrel', () => {
    const imports = sources(SRC).flatMap((file) => [
      ...readFileSync(file, 'utf8').matchAll(/^import .* from '([^']+)'/gm),
    ])
    expect(imports.map((found) => found[1])).toEqual([])
  })
})

describe('a camera', () => {
  test('finds the plane point under the screen and keeps it there through a zoom', () => {
    const camera = { x: 10, y: -5, scale: 2, turn: Math.PI / 6 }
    const under = graphPoint(camera, 400, 300, 120, 80)
    const back = screenPoint(camera, 400, 300, under)
    expect(back.x).toBeCloseTo(120, 9)
    expect(back.y).toBeCloseTo(80, 9)
    const closer = zoomed(camera, 400, 300, 120, 80, 1.5)
    const still = graphPoint(closer, 400, 300, 120, 80)
    expect(still.x).toBeCloseTo(under.x, 9)
    expect(still.y).toBeCloseTo(under.y, 9)
  })

  test('a wheel that counts lines or pages is read in pixels', () => {
    expect(wheelPixels({ deltaX: 2, deltaY: -3, deltaMode: 1 })).toEqual({ x: 80, y: -120 })
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 }, 600)).toEqual({ x: 0, y: 600 })
    expect(wheelPixels({ deltaY: 7 })).toEqual({ x: 0, y: 7 })
  })
})
