import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { atEdge, escapeLeaves, mayFill, mayHide, stillFills } from '../src/rules'

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

describe('filling the window', () => {
  test('is for a pane that shows something, on a desktop', () => {
    expect(mayFill('tab', false)).toBe(true)
    expect(mayFill(null, false)).toBe(false)
    expect(mayFill('tab', true)).toBe(false)
  })

  test('holds while its pane is worked in and shows something, and ends otherwise', () => {
    const filled = { fills: 'left', focusedId: 'left', showing: 'one' }
    expect(stillFills({ ...filled, showing: 'two' })).toBe(true)
    expect(stillFills({ ...filled, focusedId: 'right' })).toBe(false)
    expect(stillFills({ ...filled, showing: null })).toBe(false)
  })

  test('lets the bar go only when nothing holds it, and Escape ends it from outside a field or pane', () => {
    expect(mayHide({ pointer: false, keyboard: false, layers: 0 })).toBe(true)
    expect(mayHide({ pointer: true, keyboard: false, layers: 0 })).toBe(false)
    expect(escapeLeaves(null)).toBe(true)
    expect(atEdge(0)).toBe(true)
    expect(atEdge(200)).toBe(false)
  })
})
