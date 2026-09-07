import { describe, expect, test } from 'vitest'
import { paletteCss, rescoped } from './sample'

/** The miniature is drawn by the app's own prose rules, taken as text and
 *  pointed somewhere else. What is tested here is that pointing them somewhere
 *  else takes the prose and leaves everything around it: a rule that escaped the
 *  frame would restyle the settings sheet the gallery is sitting on. */

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
.nib-bar { position: fixed; }
#write p { margin: 0; }`,
      '.mini',
    )

    expect(out).toBe('.mini p { margin: 0; }')
  })

  test('leaves behind an at-rule and everything inside it', () => {
    // A rule inside a media query belongs to a screen width, and a miniature's
    // width is not the screen's. Stepped over as one block, so what is inside it
    // is not read as a rule of its own either.
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
    // Two attributes against the app's one, so the theme wins with nothing
    // marked important. If this ever stops being true, every card goes grey.
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
