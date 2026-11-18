import { describe, expect, test } from 'vitest'
import { paletteCss, rescoped, scopedRoots } from './sample'

describe('pointing the prose rules at a miniature', () => {
  test.each([
    ['#write h1 { color: red; }', '.mini h1 { color: red; }'],
    [
      ':root { --bg: #000; }\n.orden-bar { position: fixed; }\n#write p { margin: 0; }',
      '.mini p { margin: 0; }',
    ],
    [
      '@media (max-width: 720px) { #write { padding: 0; } }\n#write h2 { color: red; }',
      '.mini h2 { color: red; }',
    ],
    [
      '@keyframes ink { from { opacity: 0; } to { opacity: 1; } }\n#write p { color: red; }',
      '.mini p { color: red; }',
    ],
    ['#write { color: red; }', '.mini { color: red; }'],
    ['', ''],
    ['.other { color: red; }', ''],
  ])(
    'takes the writing surface out of %j and leaves the rest, at-rules and keyframes too',
    (css, out) => {
      expect(rescoped(css, '.mini')).toBe(out)
    },
  )

  test('takes every mention in a selector list', () => {
    const out = rescoped('#write ul,\n#write ol { margin: 0; }', '.mini')
    expect(out).toContain('.mini ul')
    expect(out).toContain('.mini ol')
    expect(out).not.toContain('#write')
  })
})

describe('the token blocks restated on the frame', () => {
  test.each([
    [':root { --space-1: 4px; }', '.mini { --space-1: 4px; }'],
    [":root,\n[data-theme='dark'] { --bg: #000; }\n[data-theme='light'] { --bg: #fff; }", ''],
    [
      ':root { --code-block-bg-color: var(--surface); }',
      '.mini { --code-block-bg-color: var(--surface); }',
    ],
    ['/* The tokens. */\n:root { --a: 1; }', '.mini { --a: 1; }'],
    ['@media (min-width: 1px) { :root { --a: 1; } }\n#write { color: red; }', ''],
  ])(
    'carries the root blocks and aliases of %j, not palettes, comments, at-rules or other rules',
    (css, out) => {
      expect(scopedRoots(css, '.mini')).toBe(out)
    },
  )
})

describe('the blocks a card is painted from', () => {
  const theme = {
    id: 'warm-paper',
    name: 'Warm Paper',
    author: 'Orden',
    version: '1.0.0',
    description: '',
    tags: [],
    licence: 'MIT',
    variants: ['light' as const],
    updated: '2026-09-07',
    palettes: { light: { '--bg': '#faf6ee', '--text': '#2b2620' }, dark: {} },
  }

  test('writes one block per theme and scheme it states, outranking the app s block for it', () => {
    const css = paletteCss([theme])
    expect(css).toContain(`[data-palette='warm-paper'][data-theme='light']`)
    expect(css).toContain('--bg: #faf6ee;')
    expect(css).not.toContain(`[data-theme='dark']`)
    const selector = css.slice(0, css.indexOf('{')).trim()
    expect(selector.split('[').length - 1).toBe(2)
  })

  test('a theme that states no tokens gets no block, and nothing at all is nothing', () => {
    expect(paletteCss([{ ...theme, palettes: { light: {}, dark: {} } }])).toBe('')
    expect(paletteCss([])).toBe('')
  })
})
