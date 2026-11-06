import { describe, expect, test } from 'vitest'
import { kindOfLetter } from './new-kind-keys'

const KINDS = [
  { kind: 'note', letter: 'n' },
  { kind: 'canvas', letter: 'c' },
  { kind: 'terminal', letter: 'r' },
]

function press(key: string, held: Partial<KeyboardEvent> = {}) {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held }
}

describe('a letter where the kinds are offered', () => {
  test('picks the kind it is the letter of', () => {
    expect(kindOfLetter(KINDS, press('c'))?.kind).toBe('canvas')
    expect(kindOfLetter(KINDS, press('x'))).toBeNull()
  })

  test('with or without Shift', () => {
    expect(kindOfLetter(KINDS, press('R', { shiftKey: true }))?.kind).toBe('terminal')
  })

  test('never under Ctrl, Alt or Cmd', () => {
    expect(kindOfLetter(KINDS, press('n', { ctrlKey: true }))).toBeNull()
    expect(kindOfLetter(KINDS, press('n', { altKey: true }))).toBeNull()
    expect(kindOfLetter(KINDS, press('n', { metaKey: true }))).toBeNull()
  })

  test('nor held down, nor while an input method is composing', () => {
    expect(kindOfLetter(KINDS, press('n', { repeat: true }))).toBeNull()
    expect(kindOfLetter(KINDS, press('n', { isComposing: true }))).toBeNull()
  })

  test('nor a key that is not a letter', () => {
    expect(kindOfLetter(KINDS, press('Enter'))).toBeNull()
  })
})
