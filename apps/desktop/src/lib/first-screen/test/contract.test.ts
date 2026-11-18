import { describe, expect, test } from 'vitest'
import { firstScreen, keepFirstScreens, sameNote } from '../src/api'
import { keptOf, wordsHash } from '../src/first-screen.svelte'

describe('the module stands on its own', () => {
  test('the api loads with nothing kept yet and the keeper asleep', () => {
    expect(typeof keepFirstScreens).toBe('function')
    expect(typeof firstScreen).toBe('object')
  })
})

describe("a note's first screen", () => {
  test('belongs to the same note whatever the path is spelled like, and no path only to none', () => {
    expect(sameNote('/a/Plan.md', '/a/Plan.md')).toBe(true)
    expect(sameNote(null, null)).toBe(true)
    expect(sameNote(null, '/a/Plan.md')).toBe(false)
  })

  test('is kept for the words it was drawn from, whatever their line endings', () => {
    expect(wordsHash('one\r\ntwo\r\n')).toBe(wordsHash('one\ntwo\n'))
    expect(wordsHash('one')).not.toBe(wordsHash('two'))
  })

  test('is read back only whole', () => {
    expect(keptOf(null)).toBeNull()
    expect(keptOf({ build: 'x', path: null, words: 'w' })).toBeNull()
  })
})
