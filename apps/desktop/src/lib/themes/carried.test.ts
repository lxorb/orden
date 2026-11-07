import { expect, test } from 'vitest'
import { carriedCss, carriedToken } from './carried'

test('a sheet written for the old names styles the app under the new ones', () => {
  const old = '.nib-row:hover { color: var(--nib-dim); --nib-setting-blur: 4px }'
  expect(carriedCss(old)).toBe(
    '.orden-row:hover { color: var(--orden-dim); --orden-setting-blur: 4px }',
  )
})

test('an id and a class or id matched by attribute are renamed too', () => {
  const old =
    '#nib-frame { margin: 0 } [id="nib-block"], [class*=" nib-row"], [class^=nib-glyph] { color: red }'
  expect(carriedCss(old)).toBe(
    '#orden-frame { margin: 0 } [id="orden-block"], [class*=" orden-row"], [class^=orden-glyph] { color: red }',
  )
})

test('only a class or a variable is renamed, never a word or an address', () => {
  const kept =
    'a.my-nib-row, url(https://x.dev/nib-row.png), .nibble, a#my-nib-x, [data-x="nib-row"], #nibble'
  expect(carriedCss(kept)).toBe(kept)
})

test('a palette token under the old name is read under the new one', () => {
  expect(carriedToken('--nib-glow')).toBe('--orden-glow')
  expect(carriedToken('--bg')).toBe('--bg')
})
