import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { webPages } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { loadWebTab, pages, siteMark, siteMuting, webDownloads } from '../src/api'

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

  test('the api loads with no web tab drawn, and the tab and its sheets behind doors', () => {
    expect(typeof pages.of).toBe('function')
    for (const door of [loadWebTab, siteMuting, webDownloads]) expect(typeof door).toBe('function')
  })
})

describe('the pages, to other modules', () => {
  test('are bound to the port once the api has loaded', () => {
    const page = pages.of('contract-tab')
    page.url = 'https://example.com/a'
    expect(webPages().of('contract-tab')).toBe(page)
    expect(webPages().addressOf('contract-tab')).toBe('https://example.com/a')
    expect(webPages().addressOf('no-such-tab')).toBeNull()
    expect(webPages().tabs()).toContain('contract-tab')
  })

  test("a site's mark is the page's own, else none for a site never seen", () => {
    expect(siteMark('data:image/png;base64,AA', 'https://example.com/')).toBe(
      'data:image/png;base64,AA',
    )
    expect(siteMark(null, 'https://never.example/', null)).toBeNull()
  })
})
