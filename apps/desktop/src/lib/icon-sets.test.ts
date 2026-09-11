import { describe, expect, test } from 'vitest'
import { EMOJI_SET, LUCIDE, rankIcons } from './icons'
import { FLAT_COLOUR, ICON_SETS, setNamed } from './icon-sets'

/** The three sets, loaded for real. Each is a chunk of its own in the app and a plain
 *  import here, which is the point of the test: the data has to be the shape the picker
 *  and the marks expect, and only reading it can say so.
 *
 *  Slow-ish, and worth it: a set whose names or groups came out wrong is a picker full
 *  of blank cells, and nothing else in the app would notice. */
describe('the sets an icon can come from', () => {
  test('are the three the picker offers, each with an id nothing else uses', () => {
    expect(ICON_SETS.map((one) => one.id)).toEqual([LUCIDE, EMOJI_SET, FLAT_COLOUR])
    expect(new Set(ICON_SETS.map((one) => one.id)).size).toBe(ICON_SETS.length)
  })

  test('and each says what it is called', () => {
    for (const set of ICON_SETS) expect(set.label, set.id).toBeTruthy()
  })

  /** Somebody else's drawings are somebody else's: the credit is what the Help panel
   *  names them by. The emoji are the platform's own font, so there is nothing of
   *  anybody's here to credit. */
  test('a set of drawings says who drew it and under what licence', () => {
    expect(setNamed(LUCIDE)?.credit).toContain('ISC')
    expect(setNamed(FLAT_COLOUR)?.credit).toContain('MIT')
    expect(setNamed(EMOJI_SET)?.credit).toBe('')
  })

  test('a set nothing here knows is nothing', () => {
    expect(setNamed('some-future-set')).toBeNull()
  })
})

describe('the emoji', () => {
  test('are the whole set, in Unicode s own nine groups', async () => {
    const held = await setNamed(EMOJI_SET)!.load()

    expect(held.groups.map((one) => one.label)).toEqual([
      'Smileys & Emotion',
      'People & Body',
      'Animals & Nature',
      'Food & Drink',
      'Travel & Places',
      'Activities',
      'Objects',
      'Symbols',
      'Flags',
    ])
    // Every one of them is in a group, and every group holds only its own.
    expect(held.groups.reduce((count, one) => count + one.names.length, 0)).toBe(
      held.entries.length,
    )
    expect(held.entries.length).toBeGreaterThan(1500)
  })

  test('are findable by the words a person would type', async () => {
    const held = await setNamed(EMOJI_SET)!.load()

    expect(rankIcons(held.entries, 'rocket', 4)).toContain('🚀')
    expect(rankIcons(held.entries, 'money bag', 4)).toContain('💰')
    expect(rankIcons(held.entries, 'calendar', 8)).toContain('📅')
  })

  /** Unicode names an emoji and says nothing about what it is for: 🚀 is called
   *  "rocket", and nothing in that is the word "launch". The keywords close that gap,
   *  and `:date:` is what Slack has taught a lot of people to call the calendar. */
  test('and by keywords that are nowhere in their names', async () => {
    const held = await setNamed(EMOJI_SET)!.load()

    expect(rankIcons(held.entries, 'launch', 4)).toContain('🚀')
    expect(rankIcons(held.entries, 'schedule', 4)).toContain('📅')
    expect(rankIcons(held.entries, 'date', 4)).toContain('📅')
    expect(rankIcons(held.entries, 'payment', 8)).toContain('💰')
  })

  /** The keywords sit behind the name rather than in it, because the name is also the
   *  cell's tooltip and what a screen reader says. Nine keywords read out is not a
   *  name. */
  test('and are called what Unicode calls them, once and no more', async () => {
    const held = await setNamed(EMOJI_SET)!.load()
    const rocket = held.entries.find((one) => one.name === '🚀')

    expect(rocket?.words).toBe('rocket')
    expect(rocket?.terms).toContain('launch')
  })

  /** One entry per emoji rather than five for five skin tones, which is the folding
   *  that keeps a picker of two thousand pictures usable. */
  test('and hold one entry per emoji, with no skin tone spelled out', async () => {
    const held = await setNamed(EMOJI_SET)!.load()
    const tones = ['🏻', '🏼', '🏽', '🏾', '🏿']

    expect(held.entries.filter((one) => tones.some((tone) => one.name.includes(tone)))).toEqual([])
  })

  test('and are drawn as the character, which needs no drawing at all', async () => {
    const held = await setNamed(EMOJI_SET)!.load()
    expect(held.shape('🚀')).toEqual({ kind: 'emoji', text: '🚀' })
  })
})

describe('a coloured set', () => {
  test('is read as finished drawings, in the box they were drawn in', async () => {
    const held = await setNamed(FLAT_COLOUR)!.load()
    const shape = held.shape('calendar')

    expect(shape?.kind).toBe('drawn')
    if (shape?.kind !== 'drawn') return

    // The elements as the file holds them, and the box they were drawn in: putting
    // one in an `<svg>` of that box is the whole of drawing it.
    expect(shape.body).toContain('<')
    expect(shape.box).toMatch(/^0 0 \d+ \d+$/)
    // Its own colours, which is the reason for the set.
    expect(shape.body).toMatch(/fill="#/)
  })

  test('has no groups, and every icon findable by its name', async () => {
    const held = await setNamed(FLAT_COLOUR)!.load()

    expect(held.groups).toEqual([])
    expect(held.entries.length).toBeGreaterThan(300)
    expect(rankIcons(held.entries, 'calendar', 4)).toContain('calendar')
  })

  /** An Iconify collection carries no keywords of its own - this one's metadata file is
   *  an empty object - so Lucide's are lent to the drawings both sets have. A folder is
   *  a directory in either set, and this is 53 of the 329 answered for nothing. */
  test('and by what Lucide says the same drawing is for', async () => {
    const held = await setNamed(FLAT_COLOUR)!.load()

    expect(rankIcons(held.entries, 'directory', 4)).toContain('folder')
    expect(rankIcons(held.entries, 'birthday', 4)).toContain('calendar')
    expect(rankIcons(held.entries, 'work', 4)).toContain('briefcase')
  })

  test('and a name it does not hold is nothing to draw', async () => {
    const held = await setNamed(FLAT_COLOUR)!.load()
    expect(held.shape('not-an-icon-anybody-drew')).toBeNull()
  })
})

describe('the stroked set', () => {
  test('is read as strokes this app dresses itself', async () => {
    const held = await setNamed(LUCIDE)!.load()
    const shape = held.shape('Rocket')

    expect(shape?.kind).toBe('stroked')
    expect(held.groups).toEqual([])
    expect(held.entries.length).toBeGreaterThan(1000)
  })

  test('and searches by the words its keys read as', async () => {
    const held = await setNamed(LUCIDE)!.load()
    expect(rankIcons(held.entries, 'book open', 4)).toContain('BookOpen')
  })

  /** Emil: the search matched names only, so "math" found nothing while "function"
   *  found one icon. Lucide's own tags are what it reads now: the angle is tagged
   *  "math", the bin is tagged "garbage", and neither word is in either name. */
  test('and by what Lucide says each icon is for', async () => {
    const held = await setNamed(LUCIDE)!.load()

    expect(rankIcons(held.entries, 'math', 12)).toContain('Angle')
    expect(rankIcons(held.entries, 'garbage', 4)).toContain('Trash2')
    expect(rankIcons(held.entries, 'function', 4)).toContain('SquareFunction')
  })

  /** 2,053 names over 1,799 drawings: `AlertCircle` and `CircleAlert` are one picture
   *  under two, and each of those names is a word somebody might look for the other by.
   *  An alias is a free synonym, and it comes with the library. */
  test('and by the other name the same drawing answers to', async () => {
    const held = await setNamed(LUCIDE)!.load()
    const alias = held.entries.find((one) => one.name === 'CircleAlert')

    expect(alias?.terms).toContain('alert circle')
    expect(alias?.words).toBe('circle alert')
  })

  /** A grid somebody is typing at rather than a command line, so a dropped letter
   *  still finds the icon - and only after everything that was spelled right. */
  test('and forgives a mistyped one without promoting it', async () => {
    const held = await setNamed(LUCIDE)!.load()

    expect(rankIcons(held.entries, 'calndar', 4)).toContain('Calendar')
    expect(rankIcons(held.entries, 'book', 4)[0]).toBe('Book')
  })

  /** Nothing typed is nothing to rank: the tab opens on the library as it comes, which
   *  is alphabetical, and the tags and aliases behind it change none of that. */
  test('and an empty query is still the library s own order', async () => {
    const held = await setNamed(LUCIDE)!.load()

    expect(rankIcons(held.entries, '', 3)).toEqual(held.entries.slice(0, 3).map((one) => one.name))
    expect(rankIcons(held.entries, '  ', 1)).toEqual(['AArrowDown'])
  })
})
