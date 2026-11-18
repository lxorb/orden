import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  conflictRule,
  DEFAULT_RULE,
  mirrorsFor,
  newMirror,
  readMirror,
  returning,
  savedRecord,
} from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')

describe('the module stands on its own', () => {
  test('the api names what the shell reads at startup and leaves the passes behind doors', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    const statics = [...api.matchAll(/^export \{[^}]*\} from '\.\/([a-z.-]+)'/gm)].map(
      (found) => found[1],
    )
    expect(statics).not.toContain('pass')
    expect(statics).not.toContain('meeting')
    expect(statics).not.toContain('holding')
    expect(statics).not.toContain('write-down')
    expect(statics).not.toContain('settling')
    expect(api).toMatch(/import\('\.\/pass'\)/)
  })
})

describe('what the sync remembers', () => {
  test('a conflict rule is one of three, and both copies when nothing was said', () => {
    expect(DEFAULT_RULE).toBe('both')
    expect(conflictRule('ask')).toBe('ask')
    expect(conflictRule('newest')).toBe('newest')
    expect(conflictRule('loudest')).toBeNull()
    expect(conflictRule(3)).toBeNull()
  })

  test('what is kept of the first engine is read for its own account alone, in either shape it was written', () => {
    const mirrors = { '/Notes': { ...newMirror('s1', '/Notes'), cursor: 4 } }
    expect(Object.keys(mirrorsFor({ account: 'u1', mirrors }, 'u1'))).toEqual(['/Notes'])
    expect(mirrorsFor({ account: 'u1', mirrors }, 'u1')['/Notes']?.cursor).toBe(4)
    expect(mirrorsFor({ account: 'u2', mirrors }, 'u1')).toEqual({})
    expect(Object.keys(mirrorsFor({ mirrors }, 'u1'))).toEqual(['/Notes'])
    expect(Object.keys(mirrorsFor(mirrors, 'u1'))).toEqual(['/Notes'])
    expect(mirrorsFor('nonsense', 'u1')).toEqual({})
  })

  test('a mirror written down is read back, and nonsense is no mirror', () => {
    const mirror = { ...newMirror('s1', '/Notes'), cursor: 4 }
    const saved = savedRecord({ account: 'u1', mirrors: { '/Notes': mirror } })
    expect(saved?.whose).toBe('u1')
    expect(saved?.seen).toBe(true)
    expect(saved?.mirrors['/Notes']?.cursor).toBe(4)
    expect(readMirror('/Notes', { cursor: 2 })).toBeNull()
    expect(savedRecord('nothing')).toBeNull()
  })

  test('a device that held another account asks before its notes meet the new one', async () => {
    const { apartName, asksOnReturn, baseFor } = await returning()
    expect(baseFor(null, 'u1')).toBe('none')
    expect(baseFor({ whose: 'u2', mirrors: { '/Notes': {} } }, 'u1')).toBe('other')
    expect(asksOnReturn('other', true)).toBe(true)
    expect(asksOnReturn('mine', true)).toBe(false)
    expect(apartName('Plans', new Set(['Plans 2']))).toBe('Plans 3')
  })
})
