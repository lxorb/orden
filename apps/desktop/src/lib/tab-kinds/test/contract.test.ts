import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TAB_KINDS as KINDS } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { isTabKind, kindsWhere, TAB_KINDS } from '../src/api'

describe('the module stands on its own', () => {
  test('reads nothing but contracts', () => {
    const text = readFileSync(join(import.meta.dirname, '../src/api.ts'), 'utf8')
    expect([...text.matchAll(/from '([^']*)'/g)].map((found) => found[1])).toEqual([
      '@orden/contracts',
    ])
  })
})

describe('the traits of every tab kind', () => {
  test('name every kind contracts knows, in its order', () => {
    expect(Object.keys(TAB_KINDS)).toEqual([...KINDS])
    expect(KINDS.every(isTabKind)).toBe(true)
    expect(isTabKind('other')).toBe(false)
  })

  test('pick the kinds that hold words, and only one settings tab', () => {
    expect(kindsWhere((traits) => traits.words)).toContain('note')
    expect(kindsWhere((traits) => traits.words)).not.toContain('terminal')
    expect(TAB_KINDS.settings.single).toBe(true)
  })
})
