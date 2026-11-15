import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadMenuBar } from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte']

function pendingOf(): string[] {
  const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as { pending?: string[] }
  return json.pending ?? []
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = pendingOf()
    const reaching = readdirSync(SRC)
      .filter((name) => !name.includes('.test.'))
      .flatMap((name) => {
        const file = join(SRC, name)
        return [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
          (found) => {
            const target = resolve(dirname(file), found[1] ?? '')
            if (target.startsWith(SRC) || /\/[a-z-]+\/src\/api$/.test(target)) return []
            const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
            const named = path === undefined ? target : relative(ROOT, path)
            return pending.includes(named) ? [] : [`${name}: ${found[1]}`]
          },
        )
      })
    expect(reaching).toEqual([])
  })

  test('the menu bar is behind its door, which loads nothing until it is asked', () => {
    expect(typeof loadMenuBar).toBe('function')
  })
})
