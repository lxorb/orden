import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { changed, ran, stepped, usageChoice, watchUsage } from '../src/api'
import { MOST_QUEUED, pruned } from '../src/queue'

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

  test('the api loads with nothing watched or sent, and every call is there', () => {
    for (const one of [changed, ran, stepped, watchUsage]) expect(typeof one).toBe('function')
    expect(typeof usageChoice.helping).toBe('boolean')
  })
})

describe('what is kept to be sent', () => {
  type UsageEvent = Parameters<typeof pruned>[0][number]
  const today = '2026-11-14'
  const daily = (day: string) => ({ kind: 'daily', day }) as unknown as UsageEvent
  const counts = (day: string) => ({ kind: 'usage', day }) as unknown as UsageEvent

  test('nothing older than the days kept, and nothing but the daily ping once help is off', () => {
    const old = '2026-10-01'
    expect(pruned([daily(old), daily(today)], today, true)).toEqual([daily(today)])
    expect(pruned([daily(today), counts(today)], today, false)).toEqual([daily(today)])
    expect(pruned([daily(today), counts(today)], today, true)).toHaveLength(2)
  })

  test('and never more than the queue holds', () => {
    const many = Array.from({ length: MOST_QUEUED + 3 }, () => daily(today))
    expect(pruned(many, today, true)).toHaveLength(MOST_QUEUED)
  })

  test('turning help off forgets the install and the days counted', () => {
    usageChoice.setHelping(true)
    const first = usageChoice.install()
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    usageChoice.setHelping(false)
    expect(usageChoice.helping).toBe(false)
    usageChoice.setHelping(true)
    expect(usageChoice.install()).not.toBe(first)
  })
})
