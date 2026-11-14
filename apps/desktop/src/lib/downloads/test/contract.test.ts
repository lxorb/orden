import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { downloadStarted, lastPress, watchPresses } from '../src/api'
import { cornerOf, flightMs, framesOf, landing, PRESS_LASTS, startOf } from '../src/path'

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

  test('the api loads with no flight drawn, and every call is there', () => {
    for (const one of [downloadStarted, lastPress, watchPresses]) {
      expect(typeof one).toBe('function')
    }
  })
})

describe('where a download flies from and to', () => {
  const area = { x: 0, y: 0, width: 1000, height: 600 }
  const press = { target: null, x: 40, y: 50, at: 1_000 }

  test('from the element that made it, else the page point, else a recent press, else the middle', () => {
    const element = { x: 100, y: 100, width: 20, height: 10 }
    const base = { element: null, page: null, press: null, pressed: null, now: 1_000, area }
    expect(startOf({ ...base, element })).toEqual({ x: 110, y: 105 })
    expect(startOf({ ...base, page: { x: 7, y: 8 } })).toEqual({ x: 7, y: 8 })
    expect(startOf({ ...base, press })).toEqual({ x: 40, y: 50 })
    expect(startOf({ ...base, press, now: 1_000 + PRESS_LASTS + 1 })).toEqual({ x: 500, y: 300 })
  })

  test("to its own tab's downloads, else the focused one, else the first, else the corner", () => {
    const box = { x: 0, y: 0, width: 1, height: 1 }
    const glyphs = [
      { box, tab: 'a', focused: false },
      { box, tab: 'b', focused: true },
    ]
    expect(landing(glyphs, 'a')?.tab).toBe('a')
    expect(landing(glyphs, null)?.tab).toBe('b')
    expect(landing([], null)).toBeNull()
    expect(cornerOf({ width: 800, height: 600 })).toEqual({ x: 768, y: 32 })
  })

  test('a flight takes longer the farther it goes, starts unseen and ends where it lands', () => {
    const from = { x: 0, y: 0 }
    expect(flightMs(from, { x: 0, y: 0 })).toBe(400)
    expect(flightMs(from, { x: 1200, y: 0 })).toBe(600)
    const frames = framesOf(from, { x: 100, y: 0 }, true)
    expect(frames[0]?.opacity).toBe('0')
    expect(frames.at(-1)?.transform).toContain('translate(100px, 0px)')
  })
})
