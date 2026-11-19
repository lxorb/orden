import { describe, expect, test, vi } from 'vitest'

vi.mock('../../platform/src/api', () => ({
  systemLocale: () => 'de-CH',
  invoke: () => Promise.resolve(),
  isDesktop: false,
  platform: () => 'linux',
}))
const { choosable, DICTIONARIES, dictionaryFor, inForceNow, toggled } = await import('../src/api')
describe('the spelling dictionaries', () => {
  test('a language finds its own dictionary, a region of it the nearest, and anything else English', () => {
    expect(dictionaryFor('en-GB')).toBe('en-GB')
    expect(dictionaryFor('de-AT')).toBe('de-DE')
    expect(dictionaryFor('xx-YY')).toBe('en-US')
  })
  test('with none chosen, the one for the system language is in force', () => {
    expect(inForceNow([])).toEqual(['de-DE'])
  })
  test('one is added or taken away, in the list order, but the last is never taken', () => {
    expect(toggled(['de-DE'], 'en-GB', true)).toEqual(['de-DE', 'en-GB'])
    expect(toggled(['de-DE', 'en-GB'], 'de-DE', false)).toEqual(['en-GB'])
    expect(toggled(['de-DE'], 'de-DE', false)).toBeNull()
    expect(DICTIONARIES.map((one) => one.id)).toContain('en-US')
  })
  test('are chosen only on a Linux desktop', () => {
    expect(choosable).toBe(false)
  })
})
