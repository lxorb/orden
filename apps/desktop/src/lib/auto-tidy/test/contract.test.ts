import { describe, expect, test, vi } from 'vitest'

const held = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => held.get(key) ?? null,
  setItem: (key: string, value: string) => void held.set(key, value),
  removeItem: (key: string) => void held.delete(key),
})
const api = await import('../src/api')
describe('the auto-tidy api', () => {
  test('names the feature once, and is off with 24 hours until chosen', () => {
    expect(api.AUTO_TIDY).toBe('Auto-tidy')
    expect(api.autoTidy.on).toBe(false)
    expect(api.autoTidy.hours).toBe(api.TIDY_HOURS)
    expect(api.TIDY_HOURS).toBe(24)
  })
  test('offers a sweep with its own clock, a test of what may close, and a start that stops', () => {
    expect(api.sweep(Date.now())).toEqual([])
    expect(typeof api.tidyable).toBe('function')
    expect(typeof api.shownTabs).toBe('function')
    expect(typeof api.startAutoTidy).toBe('function')
    expect(api.MOST_SEEN).toBeGreaterThan(0)
  })
  test('keeps what was seen in storage, bounded, and forgets it all when turned on', () => {
    api.seen.stamp(['/a.md'], 5)
    expect(JSON.parse(held.get('orden:auto-tidy-seen') ?? '{}')).toEqual({ '/a.md': 5 })
    api.seen.stamp(
      Array.from({ length: api.MOST_SEEN + 5 }, (_, at) => `/n${at}.md`),
      10,
    )
    expect(api.seen.size).toBe(api.MOST_SEEN)
    api.autoTidy.set(true)
    expect(api.seen.size).toBe(0)
    expect(held.get('orden:auto-tidy')).toBe('yes')
    api.autoTidy.set(false)
  })
  test('puts its two rows in the Tabs group of the general settings, the time only while on', async () => {
    const { tidyFields } = await import('../src/fields')
    const [toggle, after] = tidyFields()
    expect(toggle?.label).toBe(api.AUTO_TIDY)
    expect(toggle?.kind).toBe('switch')
    expect(after?.kind === 'select' && after.options.map((one) => one.value)).toEqual(['1', '12', '24', '168', '720'])
    expect(after?.label).toBe('Close tabs I haven’t looked at for')
    expect(after?.shown?.()).toBe(false)
    if (after?.kind === 'select') after.set('168')
    expect(api.autoTidy.hours).toBe(168)
  })
})
