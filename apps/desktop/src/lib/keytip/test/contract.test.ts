import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import { Caps } from '../src/api'

const capsIn = (shown: string) =>
  [...render(Caps, { props: { shown } }).body.matchAll(/<kbd[^>]*>([^<]*)<\/kbd>/g)].map((one) => one[1])
describe('the keys a shortcut is drawn with', () => {
  test('are one cap a key, in the order the system says them', () => {
    expect(capsIn('⇧⌘R')).toEqual(['⇧', '⌘', 'R'])
    expect(capsIn('⌃⌥⇧⌘K')).toEqual(['⌃', '⌥', '⇧', '⌘', 'K'])
    expect(capsIn('Ctrl+Shift+R')).toEqual(['Ctrl', 'Shift', 'R'])
    expect(capsIn('Ctrl++')).toEqual(['Ctrl', '+'])
    expect(capsIn('F5')).toEqual(['F5'])
    expect(capsIn('⇧⌘Space')).toEqual(['⇧', '⌘', 'Space'])
  })
  test('and a key pressed twice is two caps', () => {
    expect(capsIn('Shift Shift')).toEqual(['Shift', 'Shift'])
    expect(capsIn('⌘⌘')).toEqual(['⌘', '⌘'])
  })
})
