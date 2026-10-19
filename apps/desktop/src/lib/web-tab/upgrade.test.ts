/** https first and plain http where nothing answers, for a host typed with no scheme:
 *  Chrome's HTTPS-Upgrades, typed navigations only. See upgrade.ts. */

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

/** A host the field completed to a page visited over https - a dev server tried over
 *  https once, before #235, and remembered so - is tried that way and falls back too. */
test('a host the field completed to an https page falls back as well', () => {
  expect(upgradeOf('localhost:8765', 'https://localhost:8765/')).toEqual({
    tried: 'https://localhost:8765/',
    fallback: 'http://localhost:8765/',
  })
  expect(upgradeOf('exa', 'https://example.com/')).toBeNull()
})

test('nothing else falls back', () => {
  // Typed with a scheme: gone to as written.
  expect(typed('https://example.com')).toBeNull()
  expect(typed('http://example.com')).toBeNull()
  // Given http in the first place.
  expect(typed('localhost:8765')).toBeNull()
  expect(typed('example.com:8080')).toBeNull()
  // Words, and an address chosen from somewhere other than what was typed.
  expect(typed('svelte docs')).toBeNull()
  expect(upgradeOf('exam', 'https://example.com')).toBeNull()
})

const upgrade = { tried: 'https://example.com', fallback: 'http://example.com' }

test('nothing answering over https goes to http', () => {
  expect(settled(upgrade, 'https://example.com/', 'unreachable')).toBe('fallback')
  // The same site, whichever host the server sent the reader to.
  expect(settled(upgrade, 'https://www.example.com/', 'unreachable')).toBe('fallback')
})

test('a wrong certificate is shown, never stepped round', () => {
  expect(settled(upgrade, 'https://example.com/', 'certificate')).toBe('done')
})

test('a page that arrived, or failed for another reason, settles it', () => {
  expect(settled(upgrade, 'https://example.com/', null)).toBe('done')
  expect(settled(upgrade, 'https://example.com/', 'other')).toBe('done')
  // Sent to plain http by the server itself, and failing there: nothing more to try.
  expect(settled(upgrade, 'http://example.com/', 'unreachable')).toBe('done')
})

test('another site finishing as the tab left it is not the upgrade', () => {
  expect(settled(upgrade, 'https://svelte.dev/', 'unreachable')).toBe('unrelated')
  expect(settled(upgrade, 'about:blank', null)).toBe('unrelated')
})
