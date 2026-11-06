import { describe, expect, test } from 'vitest'
import {
  chorded,
  matchesCombination,
  parseCombination,
  readCombination,
  sameCombination,
  showCombination,
} from './keys'

function press(key: string, held: Partial<KeyboardEvent> & { code?: string } = {}) {
  return {
    key,
    code: held.code,
    ctrlKey: !!held.ctrlKey,
    metaKey: !!held.metaKey,
    altKey: !!held.altKey,
    shiftKey: !!held.shiftKey,
  }
}

describe('reading a written combination', () => {
  test('Mod is Ctrl off a Mac and Cmd on one', () => {
    expect(parseCombination('Mod-k', 'win')).toEqual({
      ctrl: true,
      meta: false,
      alt: false,
      shift: false,
      key: 'k',
    })
    expect(parseCombination('Mod-k', 'mac')).toEqual({
      ctrl: false,
      meta: true,
      alt: false,
      shift: false,
      key: 'k',
    })
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
    expect(
      readCombination(press('#', { ctrlKey: true, shiftKey: true, code: 'Digit3' }), 'win'),
    ).toBe('Mod-Shift-3')
    expect(
      readCombination(press('+', { ctrlKey: true, shiftKey: true, code: 'Equal' }), 'win'),
    ).toBe('Mod-Shift-=')
  })

  test('waits through the modifiers on their own', () => {
    expect(readCombination(press('Control', { ctrlKey: true }), 'win')).toBeNull()
    expect(readCombination(press('Shift', { shiftKey: true }), 'win')).toBeNull()
  })
})

describe('matching a keystroke against a binding', () => {
  test('answers to the character or to the key', () => {
    expect(
      matchesCombination(
        'Mod-Shift-3',
        press('#', { ctrlKey: true, shiftKey: true, code: 'Digit3' }),
        'win',
      ),
    ).toBe(true)
    expect(
      matchesCombination(
        'Mod-Shift-3',
        press('3', { ctrlKey: true, shiftKey: true, code: 'Digit3' }),
        'win',
      ),
    ).toBe(true)
  })

  test('a digit answers to its own key, whatever the layout needs to type it', () => {
    expect(matchesCombination('Mod-0', press('0', { ctrlKey: true, code: 'Digit0' }), 'win')).toBe(
      true,
    )
    expect(
      matchesCombination(
        'Mod-0',
        press('0', { ctrlKey: true, shiftKey: true, code: 'Digit0' }),
        'win',
      ),
    ).toBe(true)
    expect(matchesCombination('Mod-0', press('à', { ctrlKey: true, code: 'Digit0' }), 'win')).toBe(
      true,
    )
  })

  test('but a letter still wants the Shift it was written with', () => {
    expect(
      matchesCombination(
        'Mod-e',
        press('E', { ctrlKey: true, shiftKey: true, code: 'KeyE' }),
        'win',
      ),
    ).toBe(false)
    expect(
      matchesCombination(
        'Mod-Shift-e',
        press('E', { ctrlKey: true, shiftKey: true, code: 'KeyE' }),
        'win',
      ),
    ).toBe(true)
  })

  test('and Shift written into the chord is still wanted exactly', () => {
    expect(
      matchesCombination('Mod-Shift-0', press('0', { ctrlKey: true, code: 'Digit0' }), 'win'),
    ).toBe(false)
    expect(
      matchesCombination(
        'Mod-=',
        press('+', { ctrlKey: true, shiftKey: true, code: 'Equal' }),
        'win',
      ),
    ).toBe(false)
  })

  test('wants the modifiers exactly', () => {
    expect(matchesCombination('Mod-s', press('s', { ctrlKey: true, code: 'KeyS' }), 'win')).toBe(
      true,
    )
    expect(
      matchesCombination('Mod-s', press('s', { ctrlKey: true, altKey: true, code: 'KeyS' }), 'win'),
    ).toBe(false)
    expect(matchesCombination('Mod-s', press('s', { metaKey: true, code: 'KeyS' }), 'win')).toBe(
      false,
    )
  })

  test('AltGr typing a character is that character, not a chord', () => {
    const swissAt = press('@', { ctrlKey: true, altKey: true, code: 'Digit2' })
    expect(matchesCombination('Alt-2', swissAt, 'win')).toBe(false)
    expect(matchesCombination('Mod-Alt-2', swissAt, 'win')).toBe(false)
    const germanBrace = press('{', { ctrlKey: true, altKey: true, code: 'Digit7' })
    expect(matchesCombination('Mod-Alt-7', germanBrace, 'win')).toBe(false)
    const polishO = press('ó', { ctrlKey: true, altKey: true, code: 'KeyO' })
    expect(matchesCombination('Mod-Alt-o', polishO, 'win')).toBe(false)

    const usTwo = press('2', { ctrlKey: true, altKey: true, code: 'Digit2' })
    expect(matchesCombination('Mod-Alt-2', usTwo, 'win')).toBe(true)
    expect(
      matchesCombination(
        'Mod-Alt-ArrowRight',
        press('ArrowRight', { ctrlKey: true, altKey: true, code: 'ArrowRight' }),
        'win',
      ),
    ).toBe(true)
    const azertyTwo = press('2', { ctrlKey: true, altKey: true, shiftKey: true, code: 'Digit2' })
    expect(matchesCombination('Mod-Alt-2', azertyTwo, 'win')).toBe(true)
    const usShifted = press('@', { ctrlKey: true, altKey: true, shiftKey: true, code: 'Digit2' })
    expect(matchesCombination('Mod-Alt-Shift-2', usShifted, 'win')).toBe(true)
  })

  test('and the recorder writes down what the matcher will answer to', () => {
    const swissAt = press('@', { ctrlKey: true, altKey: true, code: 'Digit2' })
    expect(readCombination(swissAt, 'win')).toBe('Mod-Alt-@')
    expect(matchesCombination('Mod-Alt-@', swissAt, 'win')).toBe(true)
    expect(
      readCombination(press('2', { ctrlKey: true, altKey: true, code: 'Digit2' }), 'win'),
    ).toBe('Mod-Alt-2')
  })

  test('Alt and a digit answers to the key, whatever the layout prints on it', () => {
    expect(matchesCombination('Alt-3', press('3', { altKey: true, code: 'Digit3' }), 'win')).toBe(
      true,
    )
    expect(matchesCombination('Alt-3', press('"', { altKey: true, code: 'Digit3' }), 'win')).toBe(
      true,
    )
    expect(matchesCombination('Alt-0', press('0', { altKey: true, code: 'Digit0' }), 'linux')).toBe(
      true,
    )
    expect(
      matchesCombination('Alt-3', press('Alt', { altKey: true, code: 'AltLeft' }), 'win'),
    ).toBe(false)
  })

  test('nothing is a chord while an input method is composing', () => {
    const composing = { ...press('3', { altKey: true, code: 'Digit3' }), isComposing: true }
    expect(matchesCombination('Alt-3', composing, 'win')).toBe(false)
    expect(
      matchesCombination('Alt-3', press('Process', { altKey: true, code: 'Digit3' }), 'win'),
    ).toBe(false)
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

  test('calls the meta key what the keyboard under it calls it', () => {
    expect(showCombination('Meta-k', 'win')).toBe('Win+K')
    expect(showCombination('Meta-k', 'linux')).toBe('Super+K')
    expect(showCombination('Ctrl-k', 'mac')).toBe('⌃K')
  })

  test('names the keys that have no character', () => {
    expect(showCombination('Alt-ArrowUp', 'win')).toBe('Alt+↑')
    expect(showCombination('Escape', 'win')).toBe('Esc')
    expect(showCombination('F10', 'mac')).toBe('F10')
  })

  test.each([
    ['Escape', '⎋', 'Esc'],
    ['Delete', '⌦', 'Del'],
    ['Backspace', '⌫', 'Backspace'],
    ['Enter', '↩', 'Enter'],
    ['Tab', '⇥', 'Tab'],
    ['PageUp', '⇞', 'PgUp'],
    ['PageDown', '⇟', 'PgDn'],
    ['Home', '↖', 'Home'],
    ['End', '↘', 'End'],
    ['ArrowLeft', '←', '←'],
    ['Space', 'Space', 'Space'],
  ])('writes %s as a sign on a Mac and as a word elsewhere', (key, mac, other) => {
    expect(showCombination(key, 'mac')).toBe(mac)
    expect(showCombination(key, 'win')).toBe(other)
    expect(showCombination(key, 'linux')).toBe(other)
  })

  test('puts the key sign after the modifiers on a Mac', () => {
    expect(showCombination('Mod-Backspace', 'mac')).toBe('⌘⌫')
    expect(showCombination('Mod-Backspace', 'win')).toBe('Ctrl+Backspace')
    expect(showCombination('Mod-Ctrl-f', 'mac')).toBe('⌃⌘F')
    expect(showCombination('Ctrl-Shift-Tab', 'mac')).toBe('⌃⇧⇥')
    expect(showCombination('Mod-Shift-PageDown', 'win')).toBe('Ctrl+Shift+PgDn')
  })

  test('hands back what it cannot read rather than nothing', () => {
    expect(showCombination('Hyper-k', 'win')).toBe('Hyper-k')
  })
})

describe('the space bar', () => {
  test('is written Space and read as one', () => {
    expect(parseCombination('Mod-Shift-Space', 'win')).toEqual({
      ctrl: true,
      meta: false,
      alt: false,
      shift: true,
      key: ' ',
    })
    expect(
      readCombination(press(' ', { ctrlKey: true, shiftKey: true, code: 'Space' }), 'win'),
    ).toBe('Mod-Shift-Space')
    expect(showCombination('Mod-Shift-Space', 'win')).toBe('Ctrl+Shift+Space')
    expect(showCombination('Mod-Shift-Space', 'mac')).toBe('⇧⌘Space')
  })

  test('answers the chord the space switcher is bound to', () => {
    const chord = press(' ', { ctrlKey: true, shiftKey: true, code: 'Space' })
    expect(matchesCombination('Mod-Shift-Space', chord, 'win')).toBe(true)
    expect(matchesCombination('Mod-Shift-Space', chord, 'mac')).toBe(false)
    expect(matchesCombination('Mod-Shift-Space', press(' ', { code: 'Space' }), 'win')).toBe(false)
  })

  test('answers Ctrl+Space, and never an input method’s', () => {
    const chord = press(' ', { ctrlKey: true, code: 'Space' })
    expect(matchesCombination('Mod-Space', chord, 'win')).toBe(true)
    expect(matchesCombination('Mod-Space', chord, 'linux')).toBe(true)
    expect(
      matchesCombination('Mod-Space', press(' ', { ctrlKey: true, shiftKey: true }), 'win'),
    ).toBe(false)
    expect(
      matchesCombination('Mod-Space', press('Process', { ctrlKey: true, code: 'Space' }), 'win'),
    ).toBe(false)
    expect(matchesCombination('Mod-Space', { ...chord, isComposing: true }, 'win')).toBe(false)
    expect(showCombination('Mod-Space', 'win')).toBe('Ctrl+Space')
  })
})

describe('telling a chord from a key a widget owns', () => {
  test('a bare key, and one under Shift, belong to the widget', () => {
    expect(chorded(press(' ', { code: 'Space' }))).toBe(false)
    expect(chorded(press('Enter'))).toBe(false)
    expect(chorded(press('F10', { shiftKey: true }))).toBe(false)
  })

  test('a key under Ctrl, Alt or Cmd is on its way to the window', () => {
    expect(chorded(press(' ', { ctrlKey: true, shiftKey: true, code: 'Space' }))).toBe(true)
    expect(chorded(press('ArrowLeft', { altKey: true }))).toBe(true)
    expect(chorded(press('Enter', { metaKey: true }))).toBe(true)
  })

  test('a keystroke with nothing said about the modifiers is a bare one', () => {
    expect(chorded({ key: ' ' })).toBe(false)
  })
})

describe('a modifier tapped twice', () => {
  test('reads the way it is pressed: the sign twice on a Mac, the name twice elsewhere', () => {
    expect(showCombination('Shift Shift', 'win')).toBe('Shift Shift')
    expect(showCombination('Mod Mod', 'win')).toBe('Ctrl Ctrl')
    expect(showCombination('Meta Meta', 'linux')).toBe('Super Super')
    expect(showCombination('Shift Shift', 'mac')).toBe('⇧⇧')
    expect(showCombination('Mod Mod', 'mac')).toBe('⌘⌘')
  })

  test('is no keystroke', () => {
    expect(matchesCombination('Shift Shift', press('Shift', { shiftKey: true }), 'win')).toBe(false)
  })
})
