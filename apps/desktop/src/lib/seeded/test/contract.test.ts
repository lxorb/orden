import { beforeEach, describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const seeded = await import('../src/api')
beforeEach(() => {
  held.clear()
  seeded.forgetSeedStore()
})
describe('whether the welcome notes were written', () => {
  test('is no until marked, and yes after', async () => {
    expect(await seeded.wasSeeded()).toBe(false)
    await seeded.markSeeded()
    expect(await seeded.wasSeeded()).toBe(true)
  })
  test('is also asked of and told to a store elsewhere, which may fail', async () => {
    const told: string[] = []
    seeded.rememberSeedIn({
      read: () => Promise.resolve(true),
      write: () => Promise.resolve(void told.push('seeded')),
    })
    expect(await seeded.wasSeeded()).toBe(true)
    await seeded.markSeeded()
    expect(told).toEqual(['seeded'])
    seeded.rememberSeedIn({
      read: () => Promise.reject(new Error('gone')),
      write: () => Promise.reject(new Error('gone')),
    })
    held.clear()
    expect(await seeded.wasSeeded()).toBe(false)
    await expect(seeded.markSeeded()).resolves.toBeUndefined()
  })
})
describe('the space the welcome notes went into', () => {
  test('is kept until forgotten', () => {
    expect(seeded.seedSpaceRoot()).toBeNull()
    seeded.markSeedSpace('/Welcome')
    expect(seeded.seedSpaceRoot()).toBe('/Welcome')
    seeded.forgetSeedSpace()
    expect(seeded.seedSpaceRoot()).toBeNull()
  })
})
