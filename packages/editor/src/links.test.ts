import { describe, expect, test } from 'vitest'
import { hrefOf } from './links'

describe('what a link target is to a browser', () => {
  test('web and mail addresses pass through', () => {
    expect(hrefOf('https://x.dev/a?b=1')).toBe('https://x.dev/a?b=1')
    expect(hrefOf('HTTP://X.DEV')).toBe('HTTP://X.DEV')
    expect(hrefOf('mailto:a@b.dev')).toBe('mailto:a@b.dev')
  })

  test('a www address is given its scheme', () => {
    expect(hrefOf('www.x.dev')).toBe('https://www.x.dev')
  })

  test('paths and anchors belong to the note', () => {
    expect(hrefOf('notes/other.md')).toBeNull()
    expect(hrefOf('#heading')).toBeNull()
    expect(hrefOf('')).toBeNull()
  })
})
