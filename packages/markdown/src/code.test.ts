import { describe, expect, test } from 'vitest'
import { captionIn, languageIn } from './code'

describe('what a fence says', () => {
  test('one word is the language and nothing else', () => {
    expect(languageIn('ts')).toBe('ts')
    expect(captionIn('ts')).toBe('')
  })

  test('the words after it are what the block is', () => {
    expect(languageIn('ts src/main.ts')).toBe('ts')
    expect(captionIn('ts src/main.ts')).toBe('src/main.ts')
    expect(captionIn('sh  what it does, in words  ')).toBe('what it does, in words')
  })

  test('a fence with no info string says nothing', () => {
    expect(languageIn('')).toBe('')
    expect(captionIn('')).toBe('')
    expect(languageIn('   ')).toBe('')
    expect(captionIn('   ')).toBe('')
  })

  test('reads the other editors’ way of writing it', () => {
    expect(captionIn('js title="setup.js"')).toBe('setup.js')
    expect(captionIn("js title='setup.js'")).toBe('setup.js')
    expect(captionIn('js title=setup.js')).toBe('setup.js')
    expect(captionIn('js TITLE="Shouting"')).toBe('Shouting')
    // The language is still the language, whatever follows it.
    expect(languageIn('js title="setup.js"')).toBe('js')
  })

  test('leaves anything else as the words it is', () => {
    // Only a lone `title=` is unwrapped: a caption that happens to mention one
    // is a caption.
    expect(captionIn('js the title= line')).toBe('the title= line')
    expect(captionIn('js title="a" and more')).toBe('title="a" and more')
  })
})
