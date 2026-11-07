import { describe, expect, it } from 'vitest'
import { DEFAULT_USERNAME, username } from './username'
import { WORDS } from './words'

describe('username', () => {
  it('joins two capitalised words and a number by default', () => {
    for (let at = 0; at < 50; at++)
      expect(username(DEFAULT_USERNAME, WORDS)).toMatch(/^[A-Z][a-z]*[2-9]?[A-Z][a-z]*[2-9]?$/)
    expect(username(DEFAULT_USERNAME, ['fox'])).toMatch(/^(Fox[2-9]Fox|FoxFox[2-9])$/)
  })

  it('takes no word with a hyphen in it, which a name cannot hold', () => {
    for (let at = 0; at < 20; at++)
      expect(username(DEFAULT_USERNAME, ['drop-down', 't-shirt', 'fox'])).toMatch(
        /^(Fox[2-9]Fox|FoxFox[2-9])$/,
      )
  })

  it('writes in leet when asked', () => {
    const rule = {
      ...DEFAULT_USERNAME,
      numbers: false,
      leet: true,
      separator: 'underscore',
    } as const
    expect(username(rule, ['toast'])).toBe('70457_70457')
  })
})
