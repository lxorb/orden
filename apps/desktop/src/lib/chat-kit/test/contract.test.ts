import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { Float, Glyph, GLYPHS, placeNear } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

function pendingOf(): string[] {
  const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as { pending?: string[] }
  return json.pending ?? []
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = pendingOf()
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })

  test('the api loads with nothing floating, and every part is there', () => {
    expect(typeof Float).toBe('function')
    expect(typeof Glyph).toBe('function')
    expect(typeof placeNear).toBe('function')
  })
})

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
