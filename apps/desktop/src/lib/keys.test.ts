import { describe, expect, test } from 'vitest'
import {
  matchesCombination,
  parseCombination,
  readCombination,
  sameCombination,
  showCombination,
} from './keys'

/** A keystroke, with only the fields the reader of one looks at. */
function press(key: string, held: Partial<KeyboardEvent> & { code?: string } = {}) {
  return { key, code: held.code, ctrlKey: !!held.ctrlKey, metaKey: !!held.metaKey, altKey: !!held.altKey, shiftKey: !!held.shiftKey }
}

describe('reading a written combination', () => {
  test('Mod is Ctrl off a Mac and Cmd on one', () => {
    expect(parseCombination('Mod-k', 'win')).toEqual({ ctrl: true, meta: false, alt: false, shift: false, key: 'k' })
    expect(parseCombination('Mod-k', 'mac')).toEqual({ ctrl: false, meta: true, alt: false, shift: false, key: 'k' })
  })

  test('keeps a trailing minus as the key it is', () => {
    expect(parseCombination('Mod--', 'win')?.key).toBe('-')
    expect(parseCombination('Mod-Shift-[', 'win')?.key).toBe('[')
  })

  test('takes the modifiers in any order and the letter in any case', () => {
    expect(sameCombination('Mod-Shift-k', 'Shift-Mod-K', 'win')).toBe(true)
    expect(sameCombination('Mod-k', 'Ctrl-k', 'win')).toBe(true)
    expect(sameCombination('Mod-k', 'Ctrl-k', 'mac')).toBe(false)
  })

  test('refuses what is not one', () => {
    expect(parseCombination('', 'win')).toBeNull()
    expect(parseCombination('Hyper-k', 'win')).toBeNull()
  })
})

describe('reading a keystroke', () => {
  test('writes it the way the keymap writes it', () => {
    expect(readCombination(press('s', { ctrlKey: true, code: 'KeyS' }), 'win')).toBe('Mod-s')
    expect(readCombination(press('s', { metaKey: true, code: 'KeyS' }), 'mac')).toBe('Mod-s')
    expect(readCombination(press('F10'), 'win')).toBe('F10')
  })

  test('names the key rather than the character Shift made of it', () => {
    // Ctrl+Shift+3 arrives as `#` on a US layout and as `§` on others; the
    // key underneath is the 3, and that is what the binding says.
    expect(readCombination(press('#', { ctrlKey: true, shiftKey: true, code: 'Digit3' }), 'win')).toBe('Mod-Shift-3')
    expect(readCombination(press('+', { ctrlKey: true, shiftKey: true, code: 'Equal' }), 'win')).toBe('Mod-Shift-=')
  })

  test('waits through the modifiers on their own', () => {
    expect(readCombination(press('Control', { ctrlKey: true }), 'win')).toBeNull()
    expect(readCombination(press('Shift', { shiftKey: true }), 'win')).toBeNull()
  })
})

describe('matching a keystroke against a binding', () => {
  test('answers to the character or to the key', () => {
    expect(matchesCombination('Mod-Shift-3', press('#', { ctrlKey: true, shiftKey: true, code: 'Digit3' }), 'win')).toBe(true)
    expect(matchesCombination('Mod-Shift-3', press('3', { ctrlKey: true, shiftKey: true, code: 'Digit3' }), 'win')).toBe(true)
  })

  test('wants the modifiers exactly', () => {
    expect(matchesCombination('Mod-s', press('s', { ctrlKey: true, code: 'KeyS' }), 'win')).toBe(true)
    // Ctrl+Alt+S is not Ctrl+S with something else held down.
    expect(matchesCombination('Mod-s', press('s', { ctrlKey: true, altKey: true, code: 'KeyS' }), 'win')).toBe(false)
    expect(matchesCombination('Mod-s', press('s', { metaKey: true, code: 'KeyS' }), 'win')).toBe(false)
  })
})

describe('showing a combination', () => {
  test('is signs on a Mac and words everywhere else', () => {
    expect(showCombination('Mod-Shift-k', 'mac')).toBe('⇧⌘K')
    expect(showCombination('Mod-Shift-k', 'win')).toBe('Ctrl+Shift+K')
    expect(showCombination('Mod-Shift-k', 'linux')).toBe('Ctrl+Shift+K')
  })

  test('puts the Mac signs in the order a Mac writes them', () => {
    expect(showCombination('Mod-Alt-Ctrl-Shift-k', 'mac')).toBe('⌃⌥⇧⌘K')
  })

  test('names the keys that have no character', () => {
    expect(showCombination('Alt-ArrowUp', 'win')).toBe('Alt+↑')
    expect(showCombination('Escape', 'win')).toBe('Esc')
    expect(showCombination('F10', 'mac')).toBe('F10')
  })

  test('hands back what it cannot read rather than nothing', () => {
    expect(showCombination('Hyper-k', 'win')).toBe('Hyper-k')
  })
})
