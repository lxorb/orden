import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

const icons: Record<string, string | null> = {}

vi.mock('./workspace.svelte', () => ({
  workspace: {
    iconFor: (id: string) => icons[id] ?? null,
    tintFor: () => null,
  },
}))

const { iconLibrary } = await import('./icon-library.svelte')
const { loadIcons } = await import('./icons')
const SpaceMark = (await import('./SpaceMark.svelte')).default

iconLibrary.set = await loadIcons()

const drawn = (id: string | null, name: string): string =>
  render(SpaceMark, { props: { id, name } }).body

describe('a space whose icon can be drawn', () => {
  test('wears it, and not its letter', () => {
    icons.work = 'rocket'
    const body = drawn('work', 'Work')

    expect(body).toContain('<svg')
    expect(body).not.toContain('>W<')
  })

  test('and an emoji is the character itself', () => {
    icons.notes = '📓'
    expect(drawn('notes', 'Notes')).toContain('📓')
  })
})

describe('a space whose icon cannot be', () => {
  test('wears its letter rather than an empty badge', () => {
    icons.wat = 'not-an-icon-any-set-holds'
    const body = drawn('wat', 'Watchlist')

    expect(body).toContain('W')
    expect(body).not.toContain('<svg')
  })

  test('and so does one out of a set this build has never heard of', () => {
    icons.plans = 'flat-color-icons:calendar'
    const body = drawn('plans', 'Plans')

    expect(body).toContain('P')
    expect(body).not.toContain('<svg')
  })

  test('and so does one whose set has not arrived yet', () => {
    const held = iconLibrary.set
    iconLibrary.set = {}
    try {
      icons.later = 'rocket'
      expect(drawn('later', 'Later')).toContain('L')
    } finally {
      iconLibrary.set = held
    }
  })

  test('and so does a space that chose nothing at all', () => {
    expect(drawn(null, 'Drafts')).toContain('D')
  })

  test('and a nameless one wears the dot', () => {
    expect(drawn(null, '   ')).toContain('·')
  })
})
