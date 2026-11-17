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

const {
  forgetAccount,
  forgetHome,
  homeOf,
  keepHomes,
  leaveSpaces,
  leftBy,
  leftByAnother,
  leftGone,
  leftMoved,
} = await import('../src/api')

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

describe('the space each folder here was paired with', () => {
  test('is kept for the account that paired it, one folder for each space', () => {
    held.clear()
    keepHomes('a', [{ root: '/h/Team', spaceId: 's1' }])
    expect(homeOf('/h/Team', 'a')).toBe('s1')
    expect(homeOf('/h/Team', 'b')).toBe(null)
    expect(homeOf('/h/Team', null)).toBe(null)
    keepHomes('a', [{ root: '/h/Team 2', spaceId: 's1' }])
    expect(homeOf('/h/Team', 'a')).toBe(null)
    expect(homeOf('/h/Team 2', 'a')).toBe('s1')
  })

  test('is never kept for a folder another account left here', () => {
    held.clear()
    leaveSpaces('a', ['/h/Work'])
    keepHomes('b', [{ root: '/h/Work', spaceId: 's2' }])
    expect(homeOf('/h/Work', 'b')).toBe(null)
  })

  test('follows a renamed folder, goes with a deleted one, and outlives signing out', () => {
    held.clear()
    leaveSpaces('a', ['/h/Team'])
    keepHomes('a', [{ root: '/h/Team', spaceId: 's1' }])
    forgetAccount('a')
    expect(homeOf('/h/Team', 'a')).toBe('s1')
    leftMoved('/h/Team', '/h/Crew')
    expect(homeOf('/h/Team', 'a')).toBe(null)
    expect(homeOf('/h/Crew', 'a')).toBe('s1')
    leftGone('/h/Crew')
    expect(homeOf('/h/Crew', 'a')).toBe(null)
    keepHomes('a', [{ root: '/h/Desk', spaceId: 's3' }])
    forgetHome('/h/Desk')
    expect(homeOf('/h/Desk', 'a')).toBe(null)
  })
})
