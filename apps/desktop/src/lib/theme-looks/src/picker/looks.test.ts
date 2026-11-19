import { describe, expect, test } from 'vitest'
import tokens from '@orden/themes/tokens.css?raw'
import { contrastCss } from '@orden/themes/contrast'
import { accentTokens } from '../../../theme/src/accents'
import { lookOf } from './looks'

describe('the built-in theme', () => {
  test('is the dark palette on the dark side, and the light on the light', () => {
    const look = lookOf([tokens], 'dark')
    expect(look.ground).toBe('#0e1013')
    expect(look.side).toBe('#14171c')
    expect(look.frame).toBe('#1a1e25')
    expect(look.text).toBe('#dde2ea')
    expect(look.accent).toBe('#7c6bf5')
    const light = lookOf([tokens], 'light')
    expect(light.ground).toBe('#fbfcfd')
    expect(light.side).toBe('#f3f5f8')
    expect(light.text).toBe('#1a1d23')
  })
  test('wears the reader’s accent, and the open row is a wash of it', () => {
    const look = lookOf([tokens], 'dark', accentTokens('teal', 'dark'))
    expect(look.accent).toBe('#33c7ba')
    expect(look.open).toBe('color-mix(in srgb, #33c7ba 16%, transparent)')
  })
})
describe('a theme on top of the tokens', () => {
  test('states a side of its own, and the other side is untouched', () => {
    const pair = `[data-theme='light'] { --bg: #fdf6e3; } [data-theme="dark"] { --bg: #002b36; }`
    expect(lookOf([tokens, pair], 'light').ground).toBe('#fdf6e3')
    expect(lookOf([tokens, pair], 'dark').ground).toBe('#002b36')
    expect(lookOf([tokens, pair], 'dark').text).toBe('#dde2ea')
  })
  test.each([
    [`:root { --surface: #222222; }`, 'dark', 'side', '#222222'],
    [`:root { --side-bar-bg-color: #eeeeee; --text-color: #333; }`, 'light', 'side', '#eeeeee'],
    [`html { --bg: #123456; }`, 'dark', 'ground', '#0e1013'],
    [`body { --bg: #123456; }`, 'dark', 'ground', '#123456'],
    [`#write h1 { --bg: #123456; color: red; }`, 'dark', 'ground', '#0e1013'],
    [`:root { --bg: var(--nowhere); }`, 'dark', 'ground', ''],
    [`:root { --bg: var(--nowhere, #010203); }`, 'dark', 'ground', '#010203'],
    [`:root { --bg: var(--line); --line: var(--bg); }`, 'dark', 'ground', ''],
  ] as const)(
    '%j moves what is built on it, in Typora s names too, as the page would rank it, and never guesses',
    (css, scheme, part, shown) => {
      expect(lookOf([tokens, css], scheme)[part]).toBe(shown)
    },
  )
  test('outranks the reader’s accent only where the app lets it, which is never inline', () => {
    const own = `:root { --accent: #ff0000; }`
    expect(lookOf([tokens, own], 'dark').accent).toBe('#ff0000')
    expect(lookOf([tokens, own], 'dark', { '--accent': '#00ff00' }).accent).toBe('#00ff00')
    const loud = `:root { --accent: #ff0000 !important; }`
    expect(lookOf([tokens, loud], 'dark', { '--accent': '#00ff00' }).accent).toBe('#ff0000')
  })
})
describe('the contrast theme', () => {
  test('is black and white, in its own accent', () => {
    expect(lookOf([tokens, contrastCss], 'dark').ground).toBe('#000000')
    expect(lookOf([tokens, contrastCss], 'light').ground).toBe('#ffffff')
    expect(lookOf([tokens, contrastCss], 'light').accent).toBe('#3a25c9')
  })
})
describe('custom.css', () => {
  test('is on top of the theme, as it is on the page', () => {
    const custom = `:root { --bg: #abcdef; }`
    expect(lookOf([tokens, contrastCss, custom], 'dark').ground).toBe('#abcdef')
    const weak = `html { --bg: #abcdef; }`
    expect(lookOf([tokens, contrastCss, weak], 'dark').ground).toBe('#000000')
  })
})
