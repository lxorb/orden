import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  anythingRuns,
  owes,
  owesAtTheEnd,
  owesLast,
  runs,
  settleUp,
  stillWriting,
  writing,
  written,
} from '../src/api'

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

  test('imports nothing at all, so every module that owes a write can reach it', () => {
    const imports = sources(SRC).flatMap((file) => [
      ...readFileSync(file, 'utf8').matchAll(/^import .* from '([^']+)'/gm),
    ])
    expect(imports.map((found) => found[1])).toEqual([])
  })
})

describe('what is owed before the app goes', () => {
  test('is written in order: what is owed, then what goes last, then the end', () => {
    const order: string[] = []
    owesAtTheEnd(() => order.push('end'))
    owesLast(() => order.push('last'))
    owes(() => order.push('owed'))
    settleUp()
    expect(order).toEqual(['owed', 'last', 'end'])
  })

  test('a write underway is waited for, and a failed one does not hold anything up', async () => {
    let finish: () => void = () => undefined
    writing(new Promise<void>((resolve) => (finish = resolve)))
    writing(Promise.reject(new Error('disk full')))
    expect(stillWriting()).toBe(true)
    const done = written()
    finish()
    await done
    expect(stillWriting()).toBe(false)
  })

  test('something still running is told', () => {
    let busy = false
    runs(() => busy)
    expect(anythingRuns()).toBe(false)
    busy = true
    expect(anythingRuns()).toBe(true)
  })
})
