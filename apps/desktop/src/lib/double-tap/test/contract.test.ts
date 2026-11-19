import { describe, expect, test } from 'vitest'
import { DoubleTap, tapOf, WITHIN, writeTap } from '../src/api'

describe('a modifier tapped twice', () => {
  test('is heard on the second release within the window, and not after it', () => {
    const taps = new DoubleTap()
    const shift = { key: 'Shift', shiftKey: true }
    taps.pressed(shift, 0)
    expect(taps.released({ key: 'Shift' }, 40)).toBeNull()
    taps.pressed(shift, 100)
    expect(taps.released({ key: 'Shift' }, 140)).toBe('Shift')
    const slow = new DoubleTap()
    slow.pressed(shift, 0)
    slow.released({ key: 'Shift' }, 40)
    slow.pressed(shift, 40 + WITHIN + 1)
    expect(slow.released({ key: 'Shift' }, 80 + WITHIN)).toBeNull()
  })
  test('is not one when another key comes between', () => {
    const taps = new DoubleTap()
    taps.pressed({ key: 'Control', ctrlKey: true }, 0)
    taps.released({ key: 'Control' }, 40)
    taps.pressed({ key: 'a' }, 60)
    taps.pressed({ key: 'Control', ctrlKey: true }, 100)
    expect(taps.released({ key: 'Control' }, 140)).toBeNull()
  })
  test('is written as the modifier twice and read back, with Mod for the primary one', () => {
    expect(writeTap('Meta', 'mac')).toBe('Mod Mod')
    expect(writeTap('Control', 'win')).toBe('Mod Mod')
    expect(writeTap('Alt', 'linux')).toBe('Alt Alt')
    expect(tapOf('Mod Mod', 'mac')).toBe('Meta')
    expect(tapOf('Mod Mod', 'win')).toBe('Control')
    expect(tapOf('Shift', 'win')).toBeNull()
    expect(tapOf('Shift Alt', 'win')).toBeNull()
  })
})
