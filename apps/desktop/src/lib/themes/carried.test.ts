import { expect, test } from 'vitest'
import { carriedCss, carriedToken } from './carried'

test('a sheet written for the old names styles the app under the new ones', () => {
  const old = '.nib-row:hover { color: var(--nib-dim); --nib-setting-blur: 4px }'
  expect(carriedCss(old)).toBe(
    '.orden-row:hover { color: var(--orden-dim); --orden-setting-blur: 4px }',
  )
})

test('only a class or a variable is renamed, never a word or an address', () => {
  const kept = 'a.my-nib-row, url(https://x.dev/nib-row.png), .nibble'
  expect(carriedCss(kept)).toBe(kept)
})

test('a palette token under the old name is read under the new one', () => {
  expect(carriedToken('--nib-glow')).toBe('--orden-glow')
  expect(carriedToken('--bg')).toBe('--bg')
})
