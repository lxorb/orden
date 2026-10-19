import { describe, expect, test } from 'vitest'
import { apartName, asksOnReturn, baseFor } from './returning'

const ONE = { spaceId: 's', root: '/Notes' }

describe('whose record a device signing in holds', () => {
  test('is this account’s when the account wrote it', () => {
    expect(baseFor({ whose: 'me', mirrors: { '/Notes': ONE } }, 'me')).toBe('mine')
  })

  test('is this account’s when a version before accounts wrote it', () => {
    expect(baseFor({ whose: null, mirrors: { '/Notes': ONE } }, 'me')).toBe('mine')
  })

  test('is another’s when another account wrote it', () => {
    expect(baseFor({ whose: 'them', mirrors: { '/Notes': ONE } }, 'me')).toBe('other')
  })

  test('is nobody’s when nothing was written, or nothing was ever paired', () => {
    expect(baseFor(null, 'me')).toBe('none')
    expect(baseFor({ whose: 'me', mirrors: {} }, 'me')).toBe('none')
  })
})

describe('signing in asks', () => {
  test('never when the device is back with its own account, whatever would meet', () => {
    expect(asksOnReturn('mine', true)).toBe(false)
    expect(asksOnReturn('mine', false)).toBe(false)
  })

  test('only where notes of unknown standing would meet other words', () => {
    expect(asksOnReturn('other', true)).toBe(true)
    expect(asksOnReturn('none', true)).toBe(true)
    expect(asksOnReturn('other', false)).toBe(false)
    expect(asksOnReturn('none', false)).toBe(false)
  })
})

describe('a space kept separate', () => {
  test('takes the first number nobody has', () => {
    expect(apartName('Notes', new Set(['Notes']))).toBe('Notes 2')
    expect(apartName('Notes', new Set(['Notes', 'Notes 2', 'Notes 3']))).toBe('Notes 4')
  })
})
