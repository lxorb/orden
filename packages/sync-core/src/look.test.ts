import { describe, expect, test } from 'vitest'
import { lookIn, lookWrong, MOST_LOOK_CSS } from './look'

const LOOK = {
  theme: 'glass',
  scheme: 'dark',
  values: { '*': { accent: 'blue' }, glass: { blur: 12 } },
}

describe('a look kept with the account', () => {
  test('is a theme, a scheme and the values chosen for them', () => {
    expect(lookWrong(LOOK)).toBeNull()
    expect(lookIn(LOOK)).toEqual(LOOK)
    expect(lookWrong({ ...LOOK, theme: 'file:My Theme', css: ':root{}' })).toBeNull()
  })

  test('refuses what is not one', () => {
    expect(lookWrong(null)).not.toBeNull()
    expect(lookWrong({ ...LOOK, scheme: 'dim' })).not.toBeNull()
    expect(lookWrong({ ...LOOK, theme: '../up' })).not.toBeNull()
    expect(lookWrong({ ...LOOK, theme: 'file:a/b' })).not.toBeNull()
    expect(lookWrong({ ...LOOK, values: { '*': { accent: { deep: true } } } })).not.toBeNull()
    expect(lookWrong({ ...LOOK, css: 'x'.repeat(MOST_LOOK_CSS + 1) })).not.toBeNull()
    expect(lookWrong({ ...LOOK, more: true })).not.toBeNull()
  })

  test('read from an account keeps what it can and drops the rest', () => {
    expect(lookIn({ theme: 'glass' })).toBeNull()
    expect(
      lookIn({
        ...LOOK,
        values: { '*': { accent: 'blue', odd: [1] }, 'bad name': { a: 1 } },
        css: '',
        later: 'a field from a newer build',
      }),
    ).toEqual({ theme: 'glass', scheme: 'dark', values: { '*': { accent: 'blue' } } })
  })
})
