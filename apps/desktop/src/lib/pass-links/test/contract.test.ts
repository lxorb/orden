import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { linkUrl, newLinkId, sealedLink, shownLink } from '../src/api'
import { openedLink } from '../src/link-seal'
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
    for (const one of [linkUrl, newLinkId, sealedLink, shownLink]) {
      expect(typeof one).toBe('function')
    }
  })
})

const newKey = () => crypto.getRandomValues(new Uint8Array(32))

describe('a secure link', () => {
  test('keeps its key after the #, so the server never sees it', () => {
    const key = newKey()
    const id = newLinkId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const url = new URL(linkUrl('https://orden.so/', id, key))
    expect(url.pathname.endsWith(id)).toBe(true)
    expect(url.search).toBe('')
    expect(url.hash.length).toBeGreaterThan(1)
  })

  test('opens nothing that was not sealed to its own key and id', async () => {
    expect(await openedLink(newKey(), newLinkId(), 'not a sealed link')).toBe(null)
  })
})
