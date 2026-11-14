import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { heldLine, Link, pageWorld } from '../src/api'
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

  test('the api loads and every call is there', () => {
    expect(typeof Link).toBe('function')
    expect(typeof pageWorld).toBe('function')
  })
})

describe('who holds a session', () => {
  test('a session taken over names the device that took it', () => {
    expect(heldLine({ by: 'Phone', since: 0, taken: true })).toBe('Taken over by Phone')
    expect(heldLine({ by: '', since: 0, taken: true })).toBe('Taken over by another device')
  })

  test('a session open elsewhere says since when, with the day only when it was not today', () => {
    const now = new Date(2026, 10, 14, 12, 0).getTime()
    const today = heldLine({ by: 'Phone', since: now - 60_000, taken: false }, now)
    const before = heldLine({ by: 'Phone', since: now - 2 * 86_400_000, taken: false }, now)
    expect(today.startsWith('Open on Phone since ')).toBe(true)
    expect(before.length).toBeGreaterThan(today.length)
  })
})
