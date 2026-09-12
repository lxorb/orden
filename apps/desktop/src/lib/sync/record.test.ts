/** What the log keeps, and - the part worth a test of its own - what it lets go
 *  of. A clash holds the other device's whole note, so this store is the one
 *  place on the device where somebody else's words are written outside the vault. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

import { record } from './record.svelte'
import type { Clash } from './conflicts'

const KEY = 'nib:sync-log'

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

function aClash(path: string): Clash {
  return { path, id: 'note-id', version: 2, theirs: 'what the other device wrote', at: 1 }
}

function stored(): string {
  return localStorage.getItem(KEY) ?? ''
}

beforeEach(() => {
  localStorage.clear()
  record.restore()
})

describe('the log', () => {
  test('keeps a pass that moved something and skips one that moved nothing', () => {
    record.wrote({ at: 1, space: 'Work', pulled: 0, pushed: 0, clashed: 0, failed: null })
    expect(record.passes).toHaveLength(0)

    record.wrote({ at: 2, space: 'Work', pulled: 3, pushed: 0, clashed: 0, failed: null })
    expect(record.passes).toHaveLength(1)
  })

  test('and clearing it leaves what is still waiting to be answered', () => {
    record.clash(aClash('Plan.md'))
    record.wrote({ at: 2, space: 'Work', pulled: 3, pushed: 0, clashed: 0, failed: null })

    record.clear()

    expect(record.passes).toHaveLength(0)
    expect(record.clashes).toHaveLength(1)
  })
})

describe('signing out', () => {
  test('takes the other device’s words off this one', () => {
    // A clash is kept whole, because it is the copy the pass had in its hand. It
    // is also somebody's note in browser storage, and the session that reached it
    // has gone: leaving it behind means the next person at this machine can read
    // a note that the token no longer opens.
    record.clash(aClash('Plan.md'))
    expect(stored()).toContain('what the other device wrote')

    record.forgetEverything()

    expect(record.clashes).toHaveLength(0)
    expect(record.passes).toHaveLength(0)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})
