import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadOverview, wakeFaces } from '../src/api'
import { around } from '../src/layout'
import { land, resting, spring, step } from '../src/spring'
import { walk, wayOf } from '../src/walk'
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

  test('the api is two doors and opening neither loads the overview', () => {
    expect(typeof wakeFaces).toBe('function')
    expect(typeof loadOverview).toBe('function')
  })
})

describe('moving among the windows', () => {
  const box = (x: number, y: number) => ({ x, y, w: 100, h: 60 })
  const boxes = [box(0, 0), box(120, 0), box(0, 80)]

  test('an arrow goes to the nearest window that way and stays when there is none', () => {
    expect(wayOf('ArrowRight')).toBe('right')
    expect(wayOf('Tab')).toBeNull()
    expect(walk(boxes, 0, 'right')).toBe(1)
    expect(walk(boxes, 0, 'down')).toBe(2)
    expect(walk(boxes, 0, 'left')).toBe(0)
  })

  test('the box around the windows holds every one of them', () => {
    expect(around([])).toBeNull()
    expect(around(boxes)).toEqual({ x: 0, y: 0, w: 220, h: 140 })
  })
})

describe('the springs', () => {
  test('come to rest where they were sent and land at once when asked', () => {
    const one = spring(0)
    one.to = 100
    for (let frame = 0; frame < 600 && !resting(one); frame += 1) step(one, 1 / 60)
    expect(one.at).toBe(100)
    expect(one.speed).toBe(0)
    one.to = 40
    land(one)
    expect(one.at).toBe(40)
  })
})
