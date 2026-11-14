import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { listenSwipes, swipeChoice, swiping } from '../src/api'
import { taken } from '../src/edge'
import { distance, MOST } from '../src/gesture'

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

  test('the api loads with nothing listening and no arrow shown', () => {
    expect(typeof listenSwipes).toBe('function')
    expect(typeof swiping).toBe('object')
    expect(typeof swipeChoice.on).toBe('boolean')
  })
})

describe('when a sideways swipe goes back or forward', () => {
  test('only once nothing under the finger can still scroll that way', () => {
    const scroller = { left: 0, range: 100, rtl: false, keeps: false }
    expect(taken([scroller])).toEqual({ left: false, right: true })
    expect(taken([{ ...scroller, left: 100 }])).toEqual({ left: true, right: false })
    expect(taken([{ ...scroller, left: -100, rtl: true }])).toEqual({ left: false, right: true })
    expect(taken([{ ...scroller, left: 50, keeps: true }])).toEqual({ left: true, right: true })
  })

  test('after a distance that grows with the window and never past its cap', () => {
    expect(distance('touch', 400, 800)).toBeLessThan(distance('touch', 1600, 1000))
    expect(distance('touchpad', 100_000, 100)).toBe(MOST)
  })
})
