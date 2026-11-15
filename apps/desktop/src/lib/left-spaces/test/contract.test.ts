import { describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  key: () => null,
  length: 0,
  clear: () => held.clear(),
})

const { forgetAccount, leaveSpaces, leftBy, leftByAnother, leftGone, leftMoved } =
  await import('../src/api')

describe('the spaces this device left', () => {
  test('are marked with the account that left them, and the first mark stays', () => {
    leaveSpaces('a', ['/s/one', '/s/two'])
    leaveSpaces('b', ['/s/one', '/s/three'])
    expect(leftBy('/s/one')).toBe('a')
    expect(leftBy('/s/three')).toBe('b')
    expect(leftByAnother('/s/one', 'b')).toBe(true)
    expect(leftByAnother('/s/one', 'a')).toBe(false)
    expect(leftByAnother('/s/none', 'a')).toBe(false)
  })

  test('follow a moved folder, drop a gone one, and forget an account’s marks', () => {
    leftMoved('/s/two', '/s/moved')
    expect(leftBy('/s/two')).toBe(null)
    expect(leftBy('/s/moved')).toBe('a')
    leftGone('/s/moved')
    expect(leftBy('/s/moved')).toBe(null)
    forgetAccount('a')
    expect(leftBy('/s/one')).toBe(null)
    expect(leftBy('/s/three')).toBe('b')
  })
})
