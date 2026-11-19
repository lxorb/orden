import { describe, expect, test } from 'vitest'
import { hrefOf, linkDestination } from './links'

describe('what a link target is to a browser', () => {
  test.each([
    'https://x.dev/a?b=1',
    'HTTP://X.DEV',
    'mailto:a@b.dev',
    'nib://chat/c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e',
    'nib://settings/import',
    'orden://chat/c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e/01K6Z8Q3V8A0000000000000AB',
    'orden://settings/import',
  ])('%j passes through', (link) => expect(hrefOf(link)).toBe(link))

  test('a www address is given its scheme', () => {
    expect(hrefOf('www.x.dev')).toBe('https://www.x.dev')
  })

  test.each(['orden://open?path=Plan', 'orden://settings/account', 'notes/other.md', '#heading', ''])(
    '%j belongs to the app or the note',
    (link) => expect(hrefOf(link)).toBeNull(),
  )
})

describe('an address written the ways markdown lets it be', () => {
  test('between angle brackets, as a paste writes one with odd parentheses', () => {
    expect(hrefOf(linkDestination('<https://x.com/a)b>'))).toBe('https://x.com/a)b')
  })

  test('with its brackets escaped', () => {
    expect(hrefOf(linkDestination('https://x.com/a\\(b\\)'))).toBe('https://x.com/a(b)')
  })
})
