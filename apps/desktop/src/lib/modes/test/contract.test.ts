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
const { DEFAULTS, KEEP_MONTH, KEEP_YEAR, modes, rollbackSteps, WIDTHS } = await import('../src/api')
describe('the modes', () => {
  test('start at their defaults on a device that kept none', () => {
    expect(modes.width).toBe(DEFAULTS.width)
    expect(modes.conflicts).toBe(DEFAULTS.conflicts)
    expect(modes.keepVersions).toBe(KEEP_MONTH)
    expect(WIDTHS).toContain(DEFAULTS.width)
  })
  test('offer to roll back only as far as the versions are kept', () => {
    expect(rollbackSteps(KEEP_MONTH)).toEqual([1, 7, 30])
    expect(rollbackSteps(KEEP_YEAR).at(-1)).toBe(KEEP_YEAR)
  })
})
