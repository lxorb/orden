import { describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const { clipboardSharing } = await import('../src/api')
describe('sharing the clipboard with applications', () => {
  test('is on until turned off, and stays off', () => {
    expect(clipboardSharing.on).toBe(true)
    clipboardSharing.set(false)
    expect(clipboardSharing.on).toBe(false)
    expect([...held.values()]).toEqual(['no'])
  })
})
