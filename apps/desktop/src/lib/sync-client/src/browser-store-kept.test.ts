import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { put } from './store'

let kept: Map<string, string>
let answer: boolean
let asked: number

beforeEach(() => {
  vi.resetModules()
  kept = new Map()
  answer = false
  asked = 0
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => kept.set(key, value),
    removeItem: (key: string) => kept.delete(key),
  })
  vi.stubGlobal('navigator', {
    storage: {
      persist: () => {
        asked += 1
        return Promise.resolve(answer)
      },
      persisted: () => Promise.resolve(false),
      estimate: () => Promise.resolve({ quota: 0, usage: 0 }),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('the first change still to be sent asks, and a change the account already has does not', async () => {
  await import('../../sync-ports')
  const { openWeb } = await import('./browser-store')
  const store = await openWeb('kept-account')
  await store.write([
    put('spaces', { space_id: 's', root: 'r', cursor: 0, role: null, store: null }),
  ])
  expect(asked).toBe(0)

  await store.write([
    put('outbox', { op_id: 'o', space_id: 's', op: new Uint8Array([1]), seen: 1, made_at: 2 }),
  ])
  await vi.waitFor(() => expect(asked).toBe(1))
  await store.close()
})
