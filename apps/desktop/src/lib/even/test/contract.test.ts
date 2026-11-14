import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { HOLD, LOAD, quietFor, waitFor } from '../src/pace'
import { spokenTask } from '../src/today'

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
})

describe('the pace the glasses redraw at', () => {
  test('waits the usual pause, longer after a slow layout', () => {
    expect(quietFor(700, 5)).toBe(700)
    expect(quietFor(80, 400)).toBe(400 * LOAD)
  })

  test('never puts a redraw off past the hold', () => {
    expect(waitFor(700, 1000, 1000)).toBe(700)
    expect(waitFor(700, 0, 700 * HOLD)).toBe(0)
  })
})

describe('a task said aloud', () => {
  test('loses the word that asked for it and the closing mark', () => {
    expect(spokenTask('Remember, buy milk.')).toBe('buy milk')
    expect(spokenTask('task')).toBe('')
  })
})
