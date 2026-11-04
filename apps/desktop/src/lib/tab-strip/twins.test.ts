import { expect, test } from 'vitest'
import { initialOf, siteLook, twins } from './twins'

test('only the tabs whose look another shares wear a letter', () => {
  const tabs = [
    { id: 'a', look: 'note' },
    { id: 'b', look: 'note' },
    { id: 'c', look: 'canvas' },
    { id: 'd', look: null },
    { id: 'e', look: 'web:github.com' },
    { id: 'f', look: 'web:github.com' },
  ]
  expect([...twins(tabs)].sort()).toEqual(['a', 'b', 'e', 'f'])
})

test('a letter is the first letter or digit of the name, as a capital', () => {
  expect(initialOf('plan')).toBe('P')
  expect(initialOf('🚀 launch')).toBe('L')
  expect(initialOf('(draft) ideas')).toBe('D')
  expect(initialOf('2026 goals')).toBe('2')
  expect(initialOf('✨')).toBe('✨')
})

test('a site looks like its host', () => {
  expect(siteLook('https://github.com/lxorb/orden')).toBe('web:github.com')
  expect(siteLook('not an address')).toBeNull()
  expect(siteLook(null)).toBeNull()
})
