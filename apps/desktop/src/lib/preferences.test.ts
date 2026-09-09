import { describe, expect, test, vi } from 'vitest'

/** The declarations the settings panes are drawn from.
 *
 *  What is checked here is the shape of the list rather than the markup: which
 *  setting carries a sentence about itself, what the two controls in Appearance
 *  offer, and what the second of them points at when the theme in force cannot
 *  show the scheme that was asked for. The panel draws one row per entry and
 *  nothing else decides any of it. */

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

/** Loaded at module scope: the pane list reaches half the app, and compiling
 *  that belongs to no single test. See docs/conventions.md. */
const { preferences, resettable } = await import('./preferences')
const { theme } = await import('./theme.svelte')

const panes = preferences()
const pane = (id: string) => {
  const found = panes.find((one) => one.id === id)
  if (!found) throw new Error(`no ${id} pane`)
  return found
}

const fieldsOf = (id: string) => pane(id).groups.flatMap((group) => group.fields)

const field = (paneId: string, label: string) => {
  const found = fieldsOf(paneId).find((one) => one.label === label)
  if (!found) throw new Error(`no ${label} on ${paneId}`)
  return found
}

/** The `i` beside a label: for the settings whose name only means something to
 *  somebody who already knows the word. */
describe('the sentence behind a setting', () => {
  const HINTED = ['Strict CommonMark', 'Smart punctuation', 'Number headings', 'Number equations']

  test('is there for the markdown switches a word does not explain', () => {
    for (const label of HINTED) {
      expect(field('markdown', label).hint, label).toBeTruthy()
    }
  })

  test('and for no other setting, because a name that explains itself needs none', () => {
    const hinted = panes
      .flatMap((one) => one.groups.flatMap((group) => group.fields))
      .filter((one) => one.hint)
      .map((one) => one.label)

    expect(hinted).toEqual(HINTED)
  })

  test('is one plain sentence, which is all a tooltip has room for', () => {
    for (const label of HINTED) {
      const hint = field('markdown', label).hint ?? ''

      expect(hint, label).toMatch(/\.$/)
      expect(hint.length, label).toBeLessThan(110)
      // One sentence: a full stop only at the end of it. Numbered examples
      // spell the numbers with their own stops, which is not a second sentence.
      expect(hint.replace(/\d\.(\d)?/g, ''), label).toMatch(/^[^.]*\.$/)
    }
  })
})

describe('the Appearance pane', () => {
  test('chooses the theme with a dropdown, the built-in first', () => {
    const one = field('appearance', 'Theme')
    if (one.kind !== 'select') throw new Error('the theme is a dropdown')

    expect(one.options[0]).toEqual({ value: 'default', label: 'Default' })
    expect(one.options.map((option) => option.value)).not.toContain('dark')
    expect(one.options.map((option) => option.value)).not.toContain('light')
  })

  test('and the scheme with the segmented control the app already has', () => {
    const one = field('appearance', 'Mode')
    if (one.kind !== 'segmented') throw new Error('the mode is a segmented control')

    expect(one.options).toEqual([
      { value: 'system', label: 'System', disabled: false },
      { value: 'dark', label: 'Dark', disabled: false },
      { value: 'light', label: 'Light', disabled: false },
    ])
    expect(one.get()).toBe('system')
  })

  test('disables the segments the theme in force cannot show', () => {
    theme.files = [
      { id: 'file:warm-paper', name: 'Warm Paper', variants: ['light'], path: '/warm-paper.css' },
    ]
    theme.id = 'file:warm-paper'

    try {
      const one = preferences()
        .flatMap((pane) => pane.groups.flatMap((group) => group.fields))
        .find((entry) => entry.label === 'Mode')
      if (one?.kind !== 'segmented') throw new Error('the mode is a segmented control')

      // Following the system and the dark it does not have are both off; the one
      // scheme it does state is the one segment left.
      expect(one.options.map((option) => option.disabled)).toEqual([true, true, false])
      // And it points at the one the theme has rather than at a scheme it lacks.
      expect(one.get()).toBe('light')
    } finally {
      theme.files = []
      theme.id = 'default'
    }
  })

  test('offers no reset, since neither row is a default anybody drifted from', () => {
    expect(resettable(pane('appearance'))).toBe(false)
  })
})
