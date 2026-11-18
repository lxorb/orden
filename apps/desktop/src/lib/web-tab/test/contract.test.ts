import { webPages } from '@orden/contracts'
import { describe, expect, test } from 'vitest'
import { pages, siteMark } from '../src/api'

describe('the pages, to other modules', () => {
  test('are bound to the port once the api has loaded', () => {
    const page = pages.of('contract-tab')
    page.url = 'https://example.com/a'
    expect(webPages().of('contract-tab')).toBe(page)
    expect(webPages().addressOf('contract-tab')).toBe('https://example.com/a')
    expect(webPages().addressOf('no-such-tab')).toBeNull()
    expect(webPages().tabs()).toContain('contract-tab')
  })

  test("a site's mark is the page's own, else none for a site never seen", () => {
    expect(siteMark('data:image/png;base64,AA', 'https://example.com/')).toBe(
      'data:image/png;base64,AA',
    )
    expect(siteMark(null, 'https://never.example/', null)).toBeNull()
  })
})
