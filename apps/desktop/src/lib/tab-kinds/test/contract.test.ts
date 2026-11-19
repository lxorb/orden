import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TAB_KINDS as KINDS } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { builtinName, isTabKind, kindsWhere, readViewSpec, TAB_KINDS, writeViewSpec } from '../src/api'

describe('the module stands on its own', () => {
  test('reads nothing but contracts and the platform', () => {
    const reads = (name: string) =>
      [...readFileSync(join(import.meta.dirname, '../src', name), 'utf8').matchAll(/from '([^']*)'/g)].map(
        (found) => found[1],
      )
    expect(reads('api.ts')).toEqual(['@orden/contracts', './view-spec'])
    expect(reads('view-spec.ts')).toEqual(['../../platform/src/api'])
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

describe('the spec a view tab holds', () => {
  test('is read back as it was written, in a fixed order and with nothing unknown', () => {
    const spec = { yaml: 'views: []', path: '/s/Tasks.base', space: 's', view: 'Board' }
    const words = writeViewSpec(spec)
    expect(words).toBe('{"space":"s","path":"/s/Tasks.base","view":"Board","yaml":"views: []"}')
    expect(readViewSpec(words)).toEqual(spec)
    expect(readViewSpec('{"builtin":"todos","odd":1,"tag":3}')).toEqual({ builtin: 'todos' })
  })

  test('is nothing when the words are not a record', () => {
    expect(readViewSpec('not json')).toBeNull()
    expect(readViewSpec('[1]')).toBeNull()
  })

  test('names the built-in views', () => {
    expect(builtinName('todos')).toBe('Todos')
  })
})
