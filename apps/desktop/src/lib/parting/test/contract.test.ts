import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
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

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

describe('the module stands on its own', () => {
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
