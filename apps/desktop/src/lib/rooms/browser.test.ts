import { describe, expect, test } from 'vitest'
import { browserName } from './browser'

/** What a caret in a shared note calls the browser it belongs to.
 *
 *  The brand lists and the user agents below are the real ones, copied from the
 *  browsers rather than written to suit the code: what is under test is that a
 *  name arrives out of what a browser actually says about itself, greased brands
 *  and a Chrome in every Chromium user agent included. */

/** A brand list as `navigator.userAgentData` hands it over. */
const brands = (...names: string[]) => ({
  userAgentData: { brands: names.map((brand) => ({ brand, version: '140' })) },
})

describe('a browser that says which one it is', () => {
  test('Chrome', () => {
    expect(browserName(brands('Not_A Brand', 'Chromium', 'Google Chrome'))).toBe('Chrome')
  })

  test('Edge, which also says Chrome and Chromium', () => {
    expect(browserName(brands('Chromium', 'Not;A=Brand', 'Microsoft Edge'))).toBe('Edge')
  })

  test('Brave', () => {
    expect(browserName(brands('Not/A)Brand', 'Brave', 'Chromium'))).toBe('Brave')
  })

  test('Opera', () => {
    expect(browserName(brands('Chromium', 'Not=A?Brand', 'Opera'))).toBe('Opera')
  })

  test('Samsung Internet', () => {
    expect(browserName(brands('Chromium', 'Not.A/Brand', 'Samsung Internet'))).toBe(
      'Samsung Internet',
    )
  })

  test('a Chromium that names nothing else is Chromium', () => {
    expect(browserName(brands('Chromium', 'Not A;Brand'))).toBe('Chromium')
  })

  test('one this version has never heard of is called what it calls itself', () => {
    expect(browserName(brands('Chromium', ' Not A;Brand', 'Comet'))).toBe('Comet')
  })

  test('a list of nothing but grease falls back to the user agent', () => {
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    expect(browserName({ ...brands('Not)A;Brand'), userAgent: chrome })).toBe('Chrome')
  })

  test('a name that is not a name at all is not taken', () => {
    expect(browserName(brands('<script>'))).toBe(null)
    expect(browserName(brands('a browser with a very long name indeed'))).toBe(null)
    expect(browserName(brands('   '))).toBe(null)
  })
})

describe('a browser with no brands, read off its user agent', () => {
  const agents: [string, string][] = [
    ['Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0'],
    [
      'Firefox',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15',
    ],
    [
      'Safari',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    ],
    [
      'Safari',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    ],
    [
      'Chrome',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    ],
    [
      'Chrome',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
    ],
    [
      'Edge',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    ],
    [
      'Opera',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/125.0.0.0',
    ],
    [
      'Samsung Internet',
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
    ],
    [
      'Vivaldi',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Vivaldi/7.5.3735.54',
    ],
  ]

  test.each(agents)('%s', (name, userAgent) => {
    expect(browserName({ userAgent })).toBe(name)
  })

  test('a browser nothing recognises is left to the caller to name', () => {
    expect(browserName({ userAgent: 'Mozilla/5.0 (compatible; Lynx)' })).toBe(null)
    expect(browserName({})).toBe(null)
  })
})
