import { describe, expect, test } from 'vitest'
import { EmojiPicker, emojiRecent } from '../src/api'
import { inTone } from '../src/tones'

describe('the module stands on its own', () => {
  test('the api loads with no picker drawn and the recent ones at hand', () => {
    expect(typeof EmojiPicker).toBe('function')
    expect(typeof emojiRecent).toBe('object')
  })
})
describe('a skin tone', () => {
  const TONED = new Set(['👍', '👋'])
  test('goes after the first character of an emoji that takes one', () => {
    expect(inTone('👍', 3, TONED)).toBe('👍🏽')
  })
  test('leaves alone an emoji that takes none, and every emoji at the default tone', () => {
    expect(inTone('🎉', 3, TONED)).toBe('🎉')
    expect(inTone('👍', 0, TONED)).toBe('👍')
  })
})
