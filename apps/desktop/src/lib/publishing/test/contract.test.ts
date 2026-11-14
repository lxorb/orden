import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadPublishSheet, publish } from '../src/api'
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

  test('the api loads with the sheet closed and nothing ready to publish', () => {
    expect(publish.open).toBe(false)
    expect(publish.ready).toBe(false)
    expect(typeof loadPublishSheet).toBe('function')
  })
})

describe('the form', () => {
  test('a site never published starts on a subdomain with nothing typed', () => {
    publish.fill(undefined)
    expect(publish.subdomain).toBe('')
    expect(publish.address).toBe('subdomain')
    expect(publish.hasPassword).toBe(false)
    expect(publish.rules).toEqual({ include: [], exclude: [], otherwise: 'all' })
  })

  test('a folder is included once and let go again', () => {
    publish.rule('include', 'Blog', true)
    publish.rule('include', 'Blog', true)
    expect(publish.rules.include).toEqual(['Blog'])
    publish.rule('include', 'Blog', false)
    expect(publish.rules.include).toEqual([])
  })

  test('what is not named either goes out or stays home', () => {
    publish.otherwise('none')
    expect(publish.rules.otherwise).toBe('none')
    publish.otherwise('all')
    expect(publish.rules.otherwise).toBe('all')
  })
})
