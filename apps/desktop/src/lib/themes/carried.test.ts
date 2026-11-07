import { expect, test } from 'vitest'
import { carriedCss, carriedToken } from './carried'

test('a sheet written for the old names styles the app under the new ones', () => {
  const old = '.nib-row, #nib-frame, [class*=" nib-glyph"] { color: var(--nib-dim) }'
  expect(carriedCss(old)).toBe(
    '.orden-row, #orden-frame, [class*=" orden-glyph"] { color: var(--orden-dim) }',
  )
})

test('only a class, an id or a variable is renamed, never a word or another attribute', () => {
  const kept = 'a.my-nib-row, [data-x="nib-row"], .nibble'
  expect(carriedCss(kept)).toBe(kept)
})

test('a palette token under the old name is read under the new one', () => {
  expect(carriedToken('--nib-glow')).toBe('--orden-glow')
  expect(carriedToken('--bg')).toBe('--bg')
})
