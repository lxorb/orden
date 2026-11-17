import { describe, expect, test, vi } from 'vitest'
import { syncStore } from '@orden/contracts'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
  key: () => null,
  length: 0,
  clear: () => held.clear(),
})

const { sync } = await import('../src/api')

describe('the sync store', () => {
  test('starts off, holding no space and no note', () => {
    expect(sync.status).toBe('off')
    expect(sync.remoteIdFor('/spaces/Work')).toBeNull()
    expect(sync.tracked('/spaces/Work/Plan.md')).toBeNull()
  })

  test('serves what the lower modules ask of it through the sync.store port', () => {
    const store = syncStore()
    expect(store).not.toBeNull()
    expect(store?.remoteIdFor('/spaces/Work')).toBeNull()
    expect(store?.idOf('/spaces/Work/Plan.md')).toBeNull()
    expect(store?.entryIdAt('/spaces/Work', 'Plan.md')).toBeNull()
    expect(store?.engineReady).toBe(true)
    expect(store?.passing).toBe(false)
  })
})
