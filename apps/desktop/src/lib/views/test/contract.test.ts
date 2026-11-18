import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  baseMounting,
  baseOpening,
  createDatabase,
  loadViewTab,
  orderMoved,
  pickTemplate,
  rowsCopied,
  startRunner,
  viewTabKind,
} from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')

describe('the module stands on its own', () => {
  test('loads nothing with it, and the rest through doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const loaded = [...api.matchAll(/^export \{[^}]*\} from '([^']+)'/gm)].map((one) => one[1])
    expect(loaded).toEqual([])
    const doors = [
      loadViewTab,
      startRunner,
      baseOpening,
      baseMounting,
      rowsCopied,
      createDatabase,
      pickTemplate,
      orderMoved,
    ]
    for (const one of doors) expect(typeof one).toBe('function')
    expect(typeof viewTabKind.open).toBe('function')
    expect(typeof viewTabKind.make).toBe('function')
  })
})
