import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  loadQuickAddSheet,
  loadQuickAddWindow,
  priorityTone,
  quickAdd,
  quickAnywhere,
  quickShortcuts,
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

  test('the sheet, the window, the shortcuts and the listener open through doors', () => {
    for (const one of [loadQuickAddSheet, loadQuickAddWindow, quickShortcuts, quickAnywhere]) {
      expect(typeof one).toBe('function')
    }
  })
})

describe('asking for quick add', () => {
  test('is shown with what it was handed and hidden again', () => {
    quickAdd.show({ text: 'Call the bank', tags: ['errand'] })
    expect(quickAdd.open).toBe(true)
    expect(quickAdd.prefill).toEqual({ text: 'Call the bank', tags: ['errand'] })
    quickAdd.hide()
    expect(quickAdd.open).toBe(false)
  })

  test('is shown empty when handed nothing', () => {
    quickAdd.show()
    expect(quickAdd.prefill).toEqual({})
    quickAdd.hide()
  })

  test('keeps the smart reading and the shortcut from anywhere as they were set', () => {
    quickAdd.setSmart(false)
    quickAdd.setAnywhere(false)
    expect([quickAdd.smart, quickAdd.anywhere]).toEqual([false, false])
    quickAdd.setSmart(true)
    quickAdd.setAnywhere(true)
    expect([quickAdd.smart, quickAdd.anywhere]).toEqual([true, true])
  })
})

describe('a priority', () => {
  test('is drawn in its own tone from the first to the third, and plain after', () => {
    expect([1, 2, 3].map(priorityTone)).toEqual([
      'var(--canvas-1)',
      'var(--canvas-2)',
      'var(--canvas-5)',
    ])
    expect(priorityTone(4)).toBeUndefined()
  })
})
