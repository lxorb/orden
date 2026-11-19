import { describe, expect, test } from 'vitest'
import {
  chorded,
  matchesCombination,
  parseCombination,
  readCombination,
  sameCombination,
  showCombination,
} from './keys'

function press(key: string, mods = '', code?: string) {
  return {
    key,
    code,
    ctrlKey: mods.includes('ctrl'),
    metaKey: mods.includes('meta'),
    altKey: mods.includes('alt'),
    shiftKey: mods.includes('shift'),
  }
}
describe('reading a written combination', () => {
  test('Mod is Ctrl off a Mac and Cmd on one, Space is the space bar', () => {
    const k = { alt: false, shift: false, key: 'k' }
    expect(parseCombination('Mod-k', 'win')).toEqual({ ...k, ctrl: true, meta: false })
    expect(parseCombination('Mod-k', 'mac')).toEqual({ ...k, ctrl: false, meta: true })
    expect(parseCombination('Mod-Shift-Space', 'win')).toEqual({
      ctrl: true,
      meta: false,
      alt: false,
      shift: true,
      key: ' ',
    })
  })
  test('keeps a trailing minus, takes modifiers in any order, and refuses what is not one', () => {
    expect(parseCombination('Mod--', 'win')?.key).toBe('-')
    expect(parseCombination('Mod-Shift-[', 'win')?.key).toBe('[')
    expect(sameCombination('Mod-Shift-k', 'Shift-Mod-K', 'win')).toBe(true)
    expect(sameCombination('Mod-k', 'Ctrl-k', 'win')).toBe(true)
    expect(sameCombination('Mod-k', 'Ctrl-k', 'mac')).toBe(false)
    expect(parseCombination('', 'win')).toBeNull()
    expect(parseCombination('Hyper-k', 'win')).toBeNull()
  })
})
describe('reading a keystroke', () => {
  test.each([
    ['s', 'ctrl', 'KeyS', 'win', 'Mod-s'],
    ['s', 'meta', 'KeyS', 'mac', 'Mod-s'],
    ['F10', '', undefined, 'win', 'F10'],
    ['#', 'ctrl shift', 'Digit3', 'win', 'Mod-Shift-3'],
    ['+', 'ctrl shift', 'Equal', 'win', 'Mod-Shift-='],
    ['Control', 'ctrl', undefined, 'win', null],
    ['Shift', 'shift', undefined, 'win', null],
    ['@', 'ctrl alt', 'Digit2', 'win', 'Mod-Alt-@'],
    ['2', 'ctrl alt', 'Digit2', 'win', 'Mod-Alt-2'],
    [' ', 'ctrl shift', 'Space', 'win', 'Mod-Shift-Space'],
  ] as const)(
    'writes %j with %j the way the keymap does, naming the key, waiting through modifiers',
    (key, mods, code, platform, written) => {
      expect(readCombination(press(key, mods, code), platform)).toBe(written)
    },
  )
})
describe('matching a keystroke against a binding', () => {
  test.each([
    ['Mod-Shift-3', '#', 'ctrl shift', 'Digit3', 'win', true],
    ['Mod-Shift-3', '3', 'ctrl shift', 'Digit3', 'win', true],
    ['Mod-0', '0', 'ctrl', 'Digit0', 'win', true],
    ['Mod-0', '0', 'ctrl shift', 'Digit0', 'win', true],
    ['Mod-0', 'à', 'ctrl', 'Digit0', 'win', true],
    ['Mod-e', 'E', 'ctrl shift', 'KeyE', 'win', false],
    ['Mod-Shift-e', 'E', 'ctrl shift', 'KeyE', 'win', true],
    ['Mod-Shift-0', '0', 'ctrl', 'Digit0', 'win', false],
    ['Mod-=', '+', 'ctrl shift', 'Equal', 'win', false],
    ['Mod-s', 's', 'ctrl', 'KeyS', 'win', true],
    ['Mod-s', 's', 'ctrl alt', 'KeyS', 'win', false],
    ['Mod-s', 's', 'meta', 'KeyS', 'win', false],
    ['Alt-2', '@', 'ctrl alt', 'Digit2', 'win', false],
    ['Mod-Alt-2', '@', 'ctrl alt', 'Digit2', 'win', false],
    ['Mod-Alt-7', '{', 'ctrl alt', 'Digit7', 'win', false],
    ['Mod-Alt-o', 'ó', 'ctrl alt', 'KeyO', 'win', false],
    ['Mod-Alt-2', '2', 'ctrl alt', 'Digit2', 'win', true],
    ['Mod-Alt-ArrowRight', 'ArrowRight', 'ctrl alt', 'ArrowRight', 'win', true],
    ['Mod-Alt-2', '2', 'ctrl alt shift', 'Digit2', 'win', true],
    ['Mod-Alt-Shift-2', '@', 'ctrl alt shift', 'Digit2', 'win', true],
    ['Mod-Alt-@', '@', 'ctrl alt', 'Digit2', 'win', true],
    ['Alt-3', '3', 'alt', 'Digit3', 'win', true],
    ['Alt-3', '"', 'alt', 'Digit3', 'win', true],
    ['Alt-0', '0', 'alt', 'Digit0', 'linux', true],
    ['Alt-3', 'Alt', 'alt', 'AltLeft', 'win', false],
    ['Alt-3', 'Process', 'alt', 'Digit3', 'win', false],
    ['Mod-Shift-Space', ' ', 'ctrl shift', 'Space', 'win', true],
    ['Mod-Shift-Space', ' ', 'ctrl shift', 'Space', 'mac', false],
    ['Mod-Shift-Space', ' ', '', 'Space', 'win', false],
    ['Mod-Space', ' ', 'ctrl', 'Space', 'win', true],
    ['Mod-Space', ' ', 'ctrl', 'Space', 'linux', true],
    ['Mod-Space', ' ', 'ctrl shift', undefined, 'win', false],
    ['Mod-Space', 'Process', 'ctrl', 'Space', 'win', false],
    ['Shift Shift', 'Shift', 'shift', undefined, 'win', false],
  ] as const)('%s answers %j with %j on %s: %s', (binding, key, mods, code, platform, answers) => {
    expect(matchesCombination(binding, press(key, mods, code), platform)).toBe(answers)
  })
  test('nothing is a chord while an input method is composing', () => {
    expect(matchesCombination('Alt-3', { ...press('3', 'alt', 'Digit3'), isComposing: true }, 'win')).toBe(false)
    expect(matchesCombination('Mod-Space', { ...press(' ', 'ctrl', 'Space'), isComposing: true }, 'win')).toBe(false)
  })
})
describe('showing a combination', () => {
  test.each([
    ['Mod-Shift-k', 'mac', '⇧⌘K'],
    ['Mod-Shift-k', 'win', 'Ctrl+Shift+K'],
    ['Mod-Shift-k', 'linux', 'Ctrl+Shift+K'],
    ['Mod-Alt-Ctrl-Shift-k', 'mac', '⌃⌥⇧⌘K'],
    ['Meta-k', 'win', 'Win+K'],
    ['Meta-k', 'linux', 'Super+K'],
    ['Ctrl-k', 'mac', '⌃K'],
    ['Alt-ArrowUp', 'win', 'Alt+↑'],
    ['F10', 'mac', 'F10'],
    ['Mod-Backspace', 'mac', '⌘⌫'],
    ['Mod-Backspace', 'win', 'Ctrl+Backspace'],
    ['Mod-Ctrl-f', 'mac', '⌃⌘F'],
    ['Ctrl-Shift-Tab', 'mac', '⌃⇧⇥'],
    ['Mod-Shift-PageDown', 'win', 'Ctrl+Shift+PgDn'],
    ['Hyper-k', 'win', 'Hyper-k'],
    ['Mod-Shift-Space', 'win', 'Ctrl+Shift+Space'],
    ['Mod-Shift-Space', 'mac', '⇧⌘Space'],
    ['Mod-Space', 'win', 'Ctrl+Space'],
    ['Shift Shift', 'win', 'Shift Shift'],
    ['Mod Mod', 'win', 'Ctrl Ctrl'],
    ['Meta Meta', 'linux', 'Super Super'],
    ['Shift Shift', 'mac', '⇧⇧'],
    ['Mod Mod', 'mac', '⌘⌘'],
  ] as const)('shows %s on %s as %s, signs on a Mac in its order and words elsewhere', (key, platform, shown) => {
    expect(showCombination(key, platform)).toBe(shown)
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
})
describe('telling a chord from a key a widget owns', () => {
  test.each([
    [' ', '', 'Space', false],
    ['Enter', '', undefined, false],
    ['F10', 'shift', undefined, false],
    [' ', 'ctrl shift', 'Space', true],
    ['ArrowLeft', 'alt', undefined, true],
    ['Enter', 'meta', undefined, true],
  ] as const)('%j with %j is on its way to the window: %s', (key, mods, code, chord) => {
    expect(chorded(press(key, mods, code))).toBe(chord)
  })
  test('a keystroke with nothing said about the modifiers is a bare one', () => {
    expect(chorded({ key: ' ' })).toBe(false)
  })
})
