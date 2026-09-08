import { describe, expect, test } from 'vitest'
import { isNewer, readIndex } from './registry'

/** The catalogue arrives over the network from a repository the app does not
 *  own, so nothing in it is trusted until it has been read. A malformed
 *  catalogue has to cost the entry it is in and nothing more. */

const entry = (patch: Record<string, unknown> = {}) => ({
  id: 'warm-paper',
  name: 'Warm Paper',
  author: 'Nib',
  version: '1.0.0',
  description: 'Ink on cream.',
  tags: ['light', 'warm'],
  licence: 'MIT',
  variants: ['light'],
  updated: '2026-09-07',
  palettes: { light: { '--bg': '#faf6ee' }, dark: {} },
  ...patch,
})

describe('reading the catalogue', () => {
  test('takes an entry that says everything it has to', () => {
    const [theme] = readIndex({ themes: [entry()] })

    expect(theme?.name).toBe('Warm Paper')
    expect(theme?.variants).toEqual(['light'])
    expect(theme?.palettes.light).toEqual({ '--bg': '#faf6ee' })
  })

  test('drops an entry with nothing to show', () => {
    for (const patch of [
      { id: 'Warm Paper' },
      { id: '../etc/passwd' },
      { id: '' },
      { id: 42 },
      { name: '  ' },
      { author: null },
      { version: 1 },
      { variants: [] },
      { variants: ['blue'] },
      { variants: 'light' },
    ]) {
      expect(readIndex({ themes: [entry(patch)] }), JSON.stringify(patch)).toEqual([])
    }
  })

  test('keeps the entries around a bad one', () => {
    const themes = readIndex({
      themes: [entry({ id: 'a' }), null, 'nonsense', entry({ id: 'b' }), { id: 'c' }],
    })

    expect(themes.map((one) => one.id)).toEqual(['a', 'b'])
  })

  test('keeps the first of two entries sharing an id', () => {
    const themes = readIndex({ themes: [entry({ name: 'First' }), entry({ name: 'Second' })] })

    expect(themes).toHaveLength(1)
    expect(themes[0]?.name).toBe('First')
  })

  test('a body that is not a catalogue reads as an empty one', () => {
    for (const body of [null, 42, 'themes', [], {}, { themes: {} }, { themes: null }]) {
      expect(readIndex(body), JSON.stringify(body)).toEqual([])
    }
  })

  test('fills in what an entry may leave out', () => {
    const [theme] = readIndex({
      themes: [{ id: 'a', name: 'A', author: 'B', version: '1.0.0', variants: ['dark'] }],
    })

    expect(theme?.description).toBe('')
    expect(theme?.tags).toEqual([])
    expect(theme?.licence).toBe('')
    expect(theme?.updated).toBe('')
    expect(theme?.palettes).toEqual({ light: {}, dark: {} })
  })

  test('drops a tag or a palette entry that is not one', () => {
    const [theme] = readIndex({
      themes: [
        entry({
          tags: ['warm', 'a much longer phrase than a tag', '<script>', 'ok'],
          palettes: {
            light: { '--bg': '#fff', background: 'red', '--x': 5, '--long': 'y'.repeat(400) },
            dark: 'nonsense',
          },
        }),
      ],
    })

    expect(theme?.tags).toEqual(['warm', 'ok'])
    expect(theme?.palettes.light).toEqual({ '--bg': '#fff' })
    expect(theme?.palettes.dark).toEqual({})
  })

  test('drops a palette value that would write a rule of its own', () => {
    // The gallery pastes these into a stylesheet it injects, and it does that
    // for every card as soon as the store is opened: nobody has installed
    // anything, so nothing else has looked at them. A value here is the shortest
    // path there is from the catalogue to the whole app's CSS.
    const [theme] = readIndex({
      themes: [
        entry({
          palettes: {
            light: {
              '--bg': 'red} html{opacity:.02',
              '--surface': 'url(https://example.com/beacon.png)',
              '--line': 'red; position: fixed',
              '--text': 'red /*',
              '--muted': '"unclosed',
              '--accent': 'rgb(124 107 245 / 0.15)',
              '--danger': '#f2555a',
            },
            dark: {},
          },
        }),
      ],
    })

    expect(theme?.palettes.light).toEqual({
      '--accent': 'rgb(124 107 245 / 0.15)',
      '--danger': '#f2555a',
    })
  })

  test('drops a palette value that would swallow the cards after it', () => {
    // One block per theme in one injected stylesheet: a function left open in
    // this theme's value takes every block below it into that value, so one bad
    // entry would paint the rest of the shelf in the app's own colours. A
    // bracket inside a string is still a letter, which is what keeps a font
    // called `Half (` on its card.
    const [theme] = readIndex({
      themes: [
        entry({
          palettes: {
            light: {
              '--bg': 'rgb(0,0,0',
              '--surface': 'red)',
              '--font-content': `'Half (', serif`,
            },
            dark: {},
          },
        }),
      ],
    })

    expect(theme?.palettes.light).toEqual({ '--font-content': `'Half (', serif` })
  })

  test('keeps a font stack, which is the one token that is a sentence', () => {
    // Long enough to be worth a bound, and the bound has to clear it: a card
    // that dropped it would show a theme in the wrong typeface, which is the
    // one thing a preview must not do.
    const stack = `'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif`
    const [theme] = readIndex({
      themes: [entry({ palettes: { light: { '--font-content': stack }, dark: {} } })],
    })

    expect(theme?.palettes.light['--font-content']).toBe(stack)
  })

  test('drops a version that is not three numbers', () => {
    // It is written into the installed file and compared against what is there,
    // so an entry that cannot say plainly which version it is has nothing the
    // app can do with it.
    for (const version of ['1.0', 'next', '1.0.0-beta', '1.0.0 */ x', '']) {
      expect(readIndex({ themes: [entry({ version })] }), version).toEqual([])
    }

    expect(readIndex({ themes: [entry({ version: '10.2.30' })] })).toHaveLength(1)
  })

  test('drops a date that is not one, so newest stays newest', () => {
    expect(readIndex({ themes: [entry({ updated: 'yesterday' })] })[0]?.updated).toBe('')
    expect(readIndex({ themes: [entry({ updated: '2026-9-7' })] })[0]?.updated).toBe('')
  })
})

describe('which version is newer', () => {
  test('compares the parts as numbers', () => {
    expect(isNewer('1.10.0', '1.9.0')).toBe(true)
    expect(isNewer('1.9.0', '1.10.0')).toBe(false)
    expect(isNewer('2.0.0', '1.99.99')).toBe(true)
    expect(isNewer('1.0.1', '1.0.0')).toBe(true)
  })

  test('the same version is not newer', () => {
    expect(isNewer('1.2.3', '1.2.3')).toBe(false)
  })

  test('a version nobody can read is behind one anybody can', () => {
    expect(isNewer('next', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', 'next')).toBe(true)
    expect(isNewer('1', '1.0.0')).toBe(false)
  })
})
