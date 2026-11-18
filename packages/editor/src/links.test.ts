import { describe, expect, test } from 'vitest'
import { hrefOf } from './links'

describe('what a link target is to a browser', () => {
  test.each([
    ['https://x.dev/a?b=1', 'https://x.dev/a?b=1'],
    ['HTTP://X.DEV', 'HTTP://X.DEV'],
    ['mailto:a@b.dev', 'mailto:a@b.dev'],
    ['www.x.dev', 'https://www.x.dev'],
  ])('%j', (input, wanted) => expect(hrefOf(input)).toEqual(wanted))

  test.each([
    [
      'nib://chat/c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e',
      'nib://chat/c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e',
    ],
    ['nib://settings/import', 'nib://settings/import'],
  ])('%j', (input, wanted) => expect(hrefOf(input)).toBe(wanted))

  test('a message in a chat passes through, and no other address of the app but one', () => {
    const link = 'orden://chat/c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e/01K6Z8Q3V8A0000000000000AB'
    expect(hrefOf(link)).toBe(link)
    expect(hrefOf('orden://open?path=Plan')).toBeNull()
  })

  test("the welcome note's way to Settings > Import passes through, and no other pane", () => {
    expect(hrefOf('orden://settings/import')).toBe('orden://settings/import')
    expect(hrefOf('orden://settings/account')).toBeNull()
  })

  test.each([['notes/other.md'], ['#heading'], ['']])('%j', (input) =>
    expect(hrefOf(input)).toBeNull(),
  )
})
