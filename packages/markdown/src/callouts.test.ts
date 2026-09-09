import { describe, expect, test } from 'vitest'
import { calloutIcon, calloutOf } from './callouts'

describe('a callout’s opening line', () => {
  test('is nothing at all for a quote that names no type', () => {
    expect(calloutOf('Just a quote.')).toBeNull()
    expect(calloutOf('[not a callout] really')).toBeNull()
    expect(calloutOf('[!] empty')).toBeNull()
  })

  test('names its type however it was capitalised', () => {
    expect(calloutOf('[!NOTE]')?.type).toBe('note')
    expect(calloutOf('[!Warning]')?.type).toBe('warning')
  })

  test('resolves an alias to the look it wears, keeping the word that was written', () => {
    const found = calloutOf('[!hint] Try this')
    expect(found?.type).toBe('hint')
    expect(found?.look).toBe('tip')
  })

  test('leaves a type nothing knows without a look', () => {
    const found = calloutOf('[!recipe]')
    expect(found?.type).toBe('recipe')
    expect(found?.look).toBeNull()
    expect(found?.label).toBe('Recipe')
  })

  test('keeps the two kinds nib had first as looks of their own', () => {
    // Obsidian folds these into `tip` and `warning`. Notes written here already
    // wear their colours, so here they answer for themselves.
    expect(calloutOf('[!important]')?.look).toBe('important')
    expect(calloutOf('[!caution]')?.look).toBe('caution')
  })

  test('says the words that are not words in capitals', () => {
    expect(calloutOf('[!tldr]')?.label).toBe('TLDR')
    expect(calloutOf('[!faq]')?.label).toBe('FAQ')
    expect(calloutOf('[!abstract]')?.label).toBe('Abstract')
  })

  test('reads the fold sign, and reads none as none', () => {
    expect(calloutOf('[!note]')).toMatchObject({ foldable: false, folded: false })
    expect(calloutOf('[!note]+')).toMatchObject({ foldable: true, folded: false })
    expect(calloutOf('[!note]-')).toMatchObject({ foldable: true, folded: true })
  })

  test('takes the rest of the line as the title', () => {
    expect(calloutOf('[!tip] Mind the gap')?.title).toBe('Mind the gap')
    expect(calloutOf('[!tip]-   Mind the gap  ')?.title).toBe('Mind the gap')
    expect(calloutOf('[!tip]')?.title).toBe('')
  })

  test('measures the marker line so the words after it can be cut off exactly', () => {
    const found = calloutOf('[!tip]- Mind the gap\nBelow it.')
    expect(found?.taken).toBe('[!tip]- Mind the gap\n'.length)
    expect(found?.rest).toBe('Below it.')
  })

  test('leaves nothing behind for a marker on a line of its own', () => {
    expect(calloutOf('[!note]')?.rest).toBe('')
    expect(calloutOf('[!note]\nUnder it.')?.rest).toBe('Under it.')
  })

  test('reads a marker the writer indented', () => {
    expect(calloutOf('  [!note] Titled')?.taken).toBe('  [!note] Titled'.length)
  })
})

describe('a callout’s icon', () => {
  test('is one svg with every child closed, so an EPUB can be parsed', () => {
    const icon = calloutIcon('warning')

    expect(icon.startsWith('<svg')).toBe(true)
    expect(icon.endsWith('</svg>')).toBe(true)
    expect(icon).toContain(' />')
    // Nothing but the svg itself is left open.
    expect(/<(?!svg|\/svg)[a-z]+[^>]*[^/]>/.exec(icon)).toBeNull()
  })

  test('is nothing for a type nothing knows', () => {
    expect(calloutIcon(null)).toBe('')
    expect(calloutIcon('recipe')).toBe('')
  })

  test('draws in the colour of the words around it', () => {
    expect(calloutIcon('note')).toContain('stroke="currentColor"')
  })
})
