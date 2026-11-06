import { expect, test } from 'vitest'
import { webAddress } from './typed'
import { settled, upgradeOf } from './upgrade'

const typed = (said: string) => upgradeOf(said, webAddress(said) ?? '')

test('a host typed with no scheme, given https, may fall back to http', () => {
  expect(typed('example.com')).toEqual({
    tried: 'https://example.com',
    fallback: 'http://example.com',
  })
  expect(typed('example.com/a?b#c')?.fallback).toBe('http://example.com/a?b#c')
  expect(typed('//example.com')?.fallback).toBe('http://example.com')
})

test('a host the field completed to an https page falls back as well', () => {
  expect(upgradeOf('localhost:8765', 'https://localhost:8765/')).toEqual({
    tried: 'https://localhost:8765/',
    fallback: 'http://localhost:8765/',
  })
  expect(upgradeOf('exa', 'https://example.com/')).toBeNull()
})

test('nothing else falls back', () => {
  expect(typed('https://example.com')).toBeNull()
  expect(typed('http://example.com')).toBeNull()
  expect(typed('localhost:8765')).toBeNull()
  expect(typed('example.com:8080')).toBeNull()
  expect(typed('svelte docs')).toBeNull()
  expect(upgradeOf('exam', 'https://example.com')).toBeNull()
})

const upgrade = { tried: 'https://example.com', fallback: 'http://example.com' }

test('nothing answering over https goes to http', () => {
  expect(settled(upgrade, 'https://example.com/', 'unreachable')).toBe('fallback')
  expect(settled(upgrade, 'https://www.example.com/', 'unreachable')).toBe('fallback')
})

test('a wrong certificate is shown, never stepped round', () => {
  expect(settled(upgrade, 'https://example.com/', 'certificate')).toBe('done')
})

test('a page that arrived, or failed for another reason, settles it', () => {
  expect(settled(upgrade, 'https://example.com/', null)).toBe('done')
  expect(settled(upgrade, 'https://example.com/', 'other')).toBe('done')
  expect(settled(upgrade, 'http://example.com/', 'unreachable')).toBe('done')
})

test('another site finishing as the tab left it is not the upgrade', () => {
  expect(settled(upgrade, 'https://svelte.dev/', 'unreachable')).toBe('unrelated')
  expect(settled(upgrade, 'about:blank', null)).toBe('unrelated')
})
