import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { joining, protectionOn } from '../src/api'
import { addressesIn, looksLikeAddress } from '../src/sharing.svelte'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const LIB = join(HERE, '..')
const ROOT = join(LIB, '../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const { pending } = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as {
      pending: string[]
    }
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

  test('the invitation and the protection switch are there to read', () => {
    expect(joining.invitation).toBeNull()
    expect(typeof protectionOn()).toBe('boolean')
  })
})

describe('inviting', () => {
  test('addresses are read from what was typed, once each whatever their case', () => {
    expect(addressesIn('Ann <ann@example.org>, bob@example.com; ANN@example.org')).toEqual([
      'ann@example.org',
      'bob@example.com',
    ])
  })

  test('an address needs a name, an at and a dotted domain', () => {
    expect(looksLikeAddress('bob@example.com')).toBe(true)
    expect(looksLikeAddress('bob@example')).toBe(false)
    expect(looksLikeAddress('bob example.com')).toBe(false)
  })
})
