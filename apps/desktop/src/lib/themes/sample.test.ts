import { describe, expect, test } from 'vitest'
import { paletteCss, rescoped, scopedRoots } from './sample'

describe('pointing the prose rules at a miniature', () => {
  test('takes the rules for the writing surface', () => {
    const out = rescoped('#write h1 { color: red; }', '.mini')

    expect(out).toBe('.mini h1 { color: red; }')
  })

  test('takes every mention in a selector list', () => {
    const out = rescoped('#write ul,\n#write ol { margin: 0; }', '.mini')

    expect(out).toContain('.mini ul')
    expect(out).toContain('.mini ol')
    expect(out).not.toContain('#write')
  })

  test('leaves behind everything that is not the writing surface', () => {
    const out = rescoped(
      `:root { --bg: #000; }
.orden-bar { position: fixed; }
#write p { margin: 0; }`,
      '.mini',
    )

    expect(out).toBe('.mini p { margin: 0; }')
  })

  test('leaves behind an at-rule and everything inside it', () => {
    const out = rescoped(
      `@media (max-width: 720px) { #write { padding: 0; } }
#write h2 { color: red; }`,
      '.mini',
    )

    expect(out).toBe('.mini h2 { color: red; }')
  })

  test('leaves behind keyframes, whose steps look like rules', () => {
    const out = rescoped(
      `@keyframes ink { from { opacity: 0; } to { opacity: 1; } }
#write p { color: red; }`,
      '.mini',
    )

    expect(out).toBe('.mini p { color: red; }')
  })

  test('keeps a rule with a brace in none of its parts', () => {
    expect(rescoped('#write { color: red; }', '.mini')).toBe('.mini { color: red; }')
  })

  test('nothing to take comes out empty', () => {
    expect(rescoped('', '.mini')).toBe('')
    expect(rescoped('.other { color: red; }', '.mini')).toBe('')
  })
})

describe('the token blocks restated on the frame', () => {
  test('takes the blocks that belong to no scheme', () => {
    const out = scopedRoots(':root { --space-1: 4px; }', '.mini')

    expect(out).toBe('.mini { --space-1: 4px; }')
  })

  test('leaves the palettes alone, or every card would be the same colour', () => {
    const out = scopedRoots(
      `:root,
[data-theme='dark'] { --bg: #000; }
[data-theme='light'] { --bg: #fff; }`,
      '.mini',
    )

    expect(out).toBe('')
  })

  test('carries the aliases, which is the whole point of doing it', () => {
    const out = scopedRoots(':root { --code-block-bg-color: var(--surface); }', '.mini')

    expect(out).toContain('--code-block-bg-color: var(--surface);')
  })

  test('is not fooled by the comment above a block', () => {
    const out = scopedRoots(`/* The tokens. */\n:root { --a: 1; }`, '.mini')

    expect(out).toBe('.mini { --a: 1; }')
  })

  test('leaves behind an at-rule and anything that is not a root block', () => {
    const out = scopedRoots(
      `@media (min-width: 1px) { :root { --a: 1; } }
#write { color: red; }`,
      '.mini',
    )

    expect(out).toBe('')
  })
})

describe('the blocks a card is painted from', () => {
  const theme = {
    id: 'warm-paper',
    name: 'Warm Paper',
    author: 'Nib',
    version: '1.0.0',
    description: '',
    tags: [],
    licence: 'MIT',
    variants: ['light' as const],
    updated: '2026-09-07',
    palettes: { light: { '--bg': '#faf6ee', '--text': '#2b2620' }, dark: {} },
  }

  test('writes one block per theme and scheme it states', () => {
    const css = paletteCss([theme])

    expect(css).toContain(`[data-palette='warm-paper'][data-theme='light']`)
    expect(css).toContain('--bg: #faf6ee;')
    expect(css).not.toContain(`[data-theme='dark']`)
  })

  test('outranks the block the app writes for that scheme', () => {
    const css = paletteCss([theme])
    const selector = css.slice(0, css.indexOf('{')).trim()

    expect(selector.split('[').length - 1).toBe(2)
  })

  test('a theme that states no tokens gets no block', () => {
    expect(paletteCss([{ ...theme, palettes: { light: {}, dark: {} } }])).toBe('')
  })

  test('nothing at all is nothing', () => {
    expect(paletteCss([])).toBe('')
  })
})
