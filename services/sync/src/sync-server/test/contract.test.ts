import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { chunks, cleanPersonName, isEmail, normaliseEmail, places, staysInside } from '../src/api'
import { hooks, wire } from '../src/hooks'
import { type TestEnv, testEnv } from './fakes'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => env.close())

describe('helpers', () => {
  test('a path stays inside the space unless it climbs out, starts at a root or names a disk', () => {
    expect(staysInside('Plans/Q3.md')).toBe(true)
    expect(staysInside('../outside.md')).toBe(false)
    expect(staysInside('/etc/passwd')).toBe(false)
    expect(staysInside('C:/notes.md')).toBe(false)
    expect(staysInside('back\\slash.md')).toBe(false)
  })

  test('addresses compare without case or spaces around them, names lose control characters', () => {
    expect(normaliseEmail('  One@Example.COM ')).toBe('one@example.com')
    expect(isEmail('one@example.com')).toBe(true)
    expect(isEmail('not an address')).toBe(false)
    expect(cleanPersonName('  Ada \n  Lovelace\u0007 ')).toBe('Ada Lovelace')
  })

  test('long lists are asked in chunks with one placeholder per value', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(places(3)).toBe('?, ?, ?')
  })
})

describe('hooks', () => {
  test('the composition root wires the other services; until then the core says so', () => {
    expect(() => hooks()).toThrow(/wire/)
    const wired = {
      accounts: {
        whoever: () => Promise.resolve(null),
        sendCode: () => Promise.resolve({ ok: true as const, resendIn: 0 }),
      },
      blog: { publishesFile: () => Promise.resolve(false) },
      chats: {
        askChat: () => Promise.resolve(null),
        chatsRevoked: () => Promise.resolve(),
        closeChats: () => Promise.resolve(),
        eraseChats: (_env: unknown, chats: readonly string[]) => Promise.resolve([...chats]),
        linkPointer: () => Promise.resolve(),
      },
      feedback: {
        withdrawIssues: (_env: unknown, numbers: readonly number[]) =>
          Promise.resolve([...numbers]),
      },
      machines: {
        eraseMachines: (_env: unknown, ids: readonly string[]) => Promise.resolve([...ids]),
        endTerms: () => Promise.resolve(),
        endingTerm: () => env.DB.prepare('select 1'),
        tellEnded: () => Promise.resolve(),
        machinesRevoked: () => Promise.resolve(),
        machinesSignedOut: () => Promise.resolve(),
      },
      pass: { erased: [] },
    }
    wire(wired)
    expect(hooks()).toBe(wired)
  })
})
