import { describe, expect, test } from 'vitest'
import { settingOf } from './declared'
import { declares, paintOf, paintsOver, type ThemeSetting, valueOf } from './settings'

describe('whether the grammar is wanted at all', () => {
  test('is no for the app’s own tokens and for a theme that only states colours', () => {
    expect(declares('')).toBe(false)
    expect(declares(':root { --bg: #000; --orden-tint: 82%; }')).toBe(false)
  })

  test('and yes for one that declares a dial', () => {
    expect(declares(':root { --orden-setting-blur: range "Blur" 0 40 20 px; }')).toBe(true)
  })
})

describe('what a value is worth', () => {
  const blur = settingOf('blur', 'range "Blur" 0 40 18 px')!
  const depth = settingOf('depth', 'choice "Depth" "Flat" flat "Deep" deep')!
  const paper = settingOf('paper', 'switch "Paper" on')!

  test('nothing stored at all is what the theme said it starts as', () => {
    expect(valueOf(blur, undefined)).toBe(18)
    expect(valueOf(depth, undefined)).toBe('flat')
    expect(valueOf(paper, undefined)).toBe(true)
  })

  test('a number past the end of a range is pulled back into it', () => {
    expect(valueOf(blur, 400)).toBe(40)
    expect(valueOf(blur, -12)).toBe(0)
  })

  test('a choice the theme no longer offers falls back to its first', () => {
    expect(valueOf(depth, 'cavernous')).toBe('flat')
  })

  test('and so does a value of the wrong shape entirely', () => {
    expect(valueOf(blur, 'thick')).toBe(18)
    expect(valueOf(paper, 'yes')).toBe(true)
    expect(valueOf(depth, 3)).toBe('flat')
    expect(valueOf(blur, Number.NaN)).toBe(18)
  })

  test('a colour row holds two of the reader’s own where it says it can, and only those', () => {
    const swatches = [{ value: 'dawn', name: 'Dawn', dark: '#000000', light: '#ffffff' }]
    const plain: ThemeSetting = {
      id: 'colour',
      label: 'Colour',
      hint: '',
      kind: 'colour',
      options: swatches,
      initial: 'dawn',
      paint: () => ({}),
    }
    const paired: ThemeSetting = {
      ...plain,
      pair: {
        accepts: (held) => /^#[0-9a-f]{6} #[0-9a-f]{6}$/.test(held),
        colours: () => ['#000000', '#ffffff'],
        of: (first, second) => `${first} ${second}`,
      },
    }
    expect(valueOf(plain, '#aabbcc #112233')).toBe('dawn')
    expect(valueOf(paired, '#aabbcc #112233')).toBe('#aabbcc #112233')
    expect(valueOf(paired, '#aabbcc')).toBe('dawn')
  })
})

describe('what goes onto the page', () => {
  const settings = [
    settingOf('blur', 'range "Blur" 0 40 18 px')!,
    settingOf('paper', 'switch "Paper" on')!,
  ]

  test('is every setting at once, so there is one thing to put on and take off', () => {
    expect(paintOf(settings, { blur: 30, paper: false }, 'dark')).toEqual({
      '--orden-blur': '30px',
      '--orden-paper': '0',
    })
  })

  test('with the theme’s own answer wherever nobody has chosen one', () => {
    expect(paintOf(settings, {}, 'dark')).toEqual({ '--orden-blur': '18px', '--orden-paper': '1' })
  })
})

describe('a theme that paints a setting’s tokens itself', () => {
  const accent: ThemeSetting = {
    id: 'accent',
    label: 'Accent',
    hint: '',
    shared: true,
    kind: 'colour',
    initial: 'violet',
    options: [{ value: 'violet', name: 'Violet', dark: '#7c6bf5', light: '#5b4be0' }],
    paint: () => ({ '--accent': '#7c6bf5', '--accent-soft': 'rgb(124 107 245 / 0.15)' }),
  }

  test('withdraws it, so the row is not one that would make its own picture a lie', () => {
    expect(paintsOver("[data-theme='dark'] { --accent: #ff0000; }", accent)).toBe(true)
  })

  test('and a theme that says nothing about them keeps it', () => {
    expect(paintsOver("[data-theme='dark'] { --bg: #000; }", accent)).toBe(false)
  })

  test('as does one that keeps them where they are, which states no colour', () => {
    expect(paintsOver('.frame[data-theme] { --accent: inherit; }', accent)).toBe(false)
    expect(paintsOver('.frame { --accent: inherit; --accent-soft: red; }', accent)).toBe(true)
  })

  test('which is any one of them and not all of them', () => {
    expect(paintsOver(':root { --accent-soft: rgb(0 0 0 / 0.2); }', accent)).toBe(true)
  })

  test('and a name that merely starts the same way is not one of them', () => {
    expect(paintsOver(':root { --accents-are-nice: 1; }', accent)).toBe(false)
  })
})
