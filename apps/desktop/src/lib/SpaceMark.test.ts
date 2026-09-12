import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

/** The badge in front of a space's name, drawn rather than described.
 *
 *  One thing only rendering can show: that the badge is never empty. A space keeps
 *  whatever icon it was given, and a name no set holds - one a newer nib wrote, one
 *  somebody typed, one out of a set this build leaves out of its bundle - draws
 *  nothing at all, so asking whether an icon was chosen is not the same question as
 *  asking whether anything can be drawn. Asking the first was a square with nothing
 *  in it, on Emil's phone, where the plugin carries no coloured set: *"I don't see
 *  the icons of the spaces on the Even Realities plugin right now."* See `shapeFor`
 *  in icons.ts, which names all three cases and promises the letter for each.
 *
 *  Where a space's icon is kept is the workspace's to know and this component's not
 *  to, so that reader is stood in for. */

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

/** The stroked set, in place before anything is drawn: in the app it lands a moment
 *  after the first paint and the badges redraw themselves. The badge while it is
 *  still on its way is a case of its own below. */
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

  /** An emoji needs no set at all: the platform's own colour font is already here. */
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

  /** A value written the way a set that is not Lucide is written, for a set this
   *  build does not carry - which is every set in the plugin's own bundle. */
  test('and so does one out of a set this build has never heard of', () => {
    icons.plans = 'flat-color-icons:calendar'
    const body = drawn('plans', 'Plans')

    expect(body).toContain('P')
    expect(body).not.toContain('<svg')
  })

  /** The set on its way. The letter is what the badge holds until it lands, which is
   *  why the icon stays mounted: it is what asks for the set. */
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

  /** A folder no account has a copy of, which never had an icon to choose. */
  test('and so does a space that chose nothing at all', () => {
    expect(drawn(null, 'Drafts')).toContain('D')
  })

  /** Nothing to take a letter from either. */
  test('and a nameless one wears the dot', () => {
    expect(drawn(null, '   ')).toContain('·')
  })
})
