import { describe, expect, test } from 'vitest'
import {
  BRANDS,
  brandIcon,
  EMOJI_OUTLINE,
  EMOJI_SET,
  inOneColour,
  LUCIDE,
  rankIcons,
  readIcon,
  SITE_ICONS,
  takesTint,
  writtenIcon,
} from './icons'
import { notoOutlines } from '../../emoji-outlines'
import { BESIDE, LOOSE, SAME } from './flat-colour-places'
import {
  FLAT_COLOUR,
  ICON_SETS,
  LATER_SETS,
  type LoadedSet,
  mergeSets,
  ORDEN,
  PICKER_SETS,
  pickerCredit,
  setNamed,
} from './icon-sets'
import { FILLS_ITS_BOX } from './outline-names'

/** The three sets, loaded for real. Each is a chunk of its own in the app and a plain
 *  import here, which is the point of the test: the data has to be the shape the picker
 *  and the marks expect, and only reading it can say so.
 *
 *  Slow-ish, and worth it: a set whose names or groups came out wrong is a picker full
 *  of blank cells, and nothing else in the app would notice. */
describe('the sets an icon can come from', () => {
  test('are the six the picker offers, each with an id nothing else uses', () => {
    expect(ICON_SETS.map((one) => one.id)).toEqual([
      LUCIDE,
      EMOJI_SET,
      FLAT_COLOUR,
      EMOJI_OUTLINE,
      SITE_ICONS,
      BRANDS,
    ])
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

/** One search over every set, and no tabs (#1096). */
describe('the sets the picker searches', () => {
  test('are every set, each once, the brands waiting for a search', () => {
    // The emoji's outlines are drawn in the emoji's own cells, not as cells of their own,
    // and the Web icons are the account's, a section the picker draws first (#1054).
    expect([...PICKER_SETS, EMOJI_OUTLINE, SITE_ICONS].sort()).toEqual(
      ICON_SETS.map((one) => one.id).sort(),
    )
    expect(new Set(PICKER_SETS).size).toBe(PICKER_SETS.length)
    expect([...LATER_SETS]).toEqual([BRANDS])
  })

  test('credit whoever drew each of them', () => {
    for (const set of ICON_SETS) expect(pickerCredit()).toContain(set.credit)
  })

  test('are one list: the emoji s groups, then the line icons and the brands', async () => {
    const parts = await Promise.all(
      PICKER_SETS.map(async (id) => ({ id, held: await setNamed(id)!.load() })),
    )
    const held = mergeSets(parts)
    const labels = held.groups.map((one) => one.label)

    expect(labels.slice(-2)).toEqual(['Line', 'Brands'])
    expect(new Set(held.entries.map((one) => one.name)).size).toBe(held.entries.length)
    // A search ranks across the sets: a rocket is a line, an emoji and a drawing.
    const found = rankIcons(held.entries, 'rocket', 20)
    expect(found).toContain('rocket')
    expect(found).toContain('🚀')
  })
})

describe('the places of the coloured drawings among the emoji', () => {
  test('name every drawing exactly once, beside emoji and in groups that exist', async () => {
    const [emoji, flat] = await Promise.all([
      setNamed(EMOJI_SET)!.load(),
      setNamed(FLAT_COLOUR)!.load(),
    ])
    const named = [
      ...Object.keys(SAME),
      ...Object.values(BESIDE).flatMap((names) => names.split(' ')),
      ...Object.values(LOOSE).flatMap((names) => names.split(' ')),
    ]
    const emojis = new Set(emoji.entries.map((one) => one.name))

    expect([...named].sort()).toEqual([...flat.entries.map((one) => one.name)].sort())
    for (const one of [...Object.values(SAME), ...Object.keys(BESIDE)]) {
      expect(emojis.has(one), one).toBe(true)
    }
    for (const group of Object.keys(LOOSE)) {
      expect(emoji.groups.map((one) => one.label)).toContain(group)
    }
  })
})

describe('the picture tab', () => {
  const merged = async () => {
    const parts = await Promise.all(
      [EMOJI_SET, FLAT_COLOUR].map(async (id) => ({ id, held: await setNamed(id)!.load() })),
    )
    return mergeSets(parts)
  }

  test('is the emoji s groups, with the drawings in them and every icon once', async () => {
    const held = await merged()
    const names = held.entries.map((one) => one.name)

    expect(held.groups.map((one) => one.label)).toEqual(
      (await setNamed(EMOJI_SET)!.load()).groups.map((one) => one.label),
    )
    expect(new Set(names).size).toBe(names.length)
    // The order the arrows walk is the order the groups show.
    expect(names).toEqual(held.groups.flatMap((one) => one.names))
  })

  /** By topic rather than in two blocks: the pie chart sits after the bar chart, the
   *  SIM card after the phone. */
  test('puts a drawing beside what it is about', async () => {
    const objects = (await merged()).groups.find((one) => one.label === 'Objects')!.names
    const at = (name: string) => objects.indexOf(name)

    // Straight after it, in the set's own order, and before the next emoji.
    const run = (emoji: string) => {
      const from = at(emoji) + 1
      let to = from
      while (objects[to]?.startsWith(`${FLAT_COLOUR}:`)) to++
      return objects.slice(from, to)
    }

    expect(run('📊')).toContain(`${FLAT_COLOUR}:pie-chart`)
    expect(run('📱')).toContain(`${FLAT_COLOUR}:sim-card`)
    // And the ones with no neighbour at the end of their group.
    const loose = LOOSE.Objects!.split(' ').map((name) => `${FLAT_COLOUR}:${name}`)
    expect([...objects.slice(-loose.length)].sort()).toEqual([...loose].sort())
  })

  /** The same calendar twice is one too many. The emoji stays, because the tab is two
   *  thousand of those, and takes the drawing's words with it. */
  test('shows a picture both sets draw once, as the emoji', async () => {
    const held = await merged()
    const names = new Set(held.entries.map((one) => one.name))

    for (const name of Object.keys(SAME)) expect(names.has(`${FLAT_COLOUR}:${name}`)).toBe(false)
    expect(names.has('📅')).toBe(true)
    expect(rankIcons(held.entries, 'calendar', 2)).toContain('📅')
  })

  test('is searched as one, whichever set an answer is from', async () => {
    const held = await merged()

    expect(rankIcons(held.entries, 'rocket', 4)).toContain('🚀')
    expect(rankIcons(held.entries, 'pie chart', 4)).toContain(`${FLAT_COLOUR}:pie-chart`)
    expect(rankIcons(held.entries, 'directory', 8)).toContain('📁')
  })

  /** A drawing chosen before the tabs were merged keeps drawing: what it wrote is
   *  still what its set draws, even when the grid shows its twin instead. */
  test('leaves a drawing already chosen drawable', async () => {
    const flat = await setNamed(FLAT_COLOUR)!.load()
    expect(flat.shape('calendar')?.kind).toBe('drawn')
  })
})

describe('merging sets', () => {
  const set = (names: string[], groups: LoadedSet['groups'] = []): LoadedSet => ({
    entries: names.map((name) => ({ name, words: name })),
    groups,
    shape: () => null,
  })

  /** A drawing whose place names nothing the frame holds is still shown, in a group
   *  of its own, rather than dropped. */
  test('keeps an icon whose place is nowhere', () => {
    const frame = set(['a', 'b'], [{ label: 'Letters', names: ['a', 'b'] }])
    const extra = {
      ...set(['x', 'y']),
      place: (name: string) => (name === 'x' ? { after: 'a' } : null),
    }

    const held = mergeSets([
      { id: EMOJI_SET, held: frame },
      { id: 'later', held: extra },
    ])

    expect(held.groups).toEqual([
      { label: 'Letters', names: ['a', 'later:x', 'b'] },
      { label: 'later', names: ['later:y'] },
    ])
  })

  test('and without a frame is the sets one after another, under what they write', () => {
    const held = mergeSets([{ id: LUCIDE, held: set(['BookOpen']) }])

    expect(held.groups).toEqual([])
    expect(held.entries.map((one) => one.name)).toEqual(['book-open'])
  })
})

/** #1082: the logos of products and companies, Simple Icons' whole set. */
describe('the brands', () => {
  const brands = () => setNamed(BRANDS)!.load()

  test('are every logo Simple Icons draws, each a finished drawing', async () => {
    const held = await brands()

    expect(held.entries.length).toBeGreaterThan(3000)
    expect(held.groups).toEqual([])
    for (const slug of [
      'blender',
      'obsstudio',
      'anthropic',
      'claude',
      'openai',
      'youtube',
      'linkedin',
      'github',
      'google',
      'discord',
      'slack',
      'spotify',
      'figma',
      'notion',
      'visualstudiocode',
    ]) {
      expect(held.shape(slug)?.kind, slug).toBe('drawn')
    }
  })

  /** Drawn in the colour of the text around them, which is what keeps GitHub's black
   *  mark from vanishing into a dark theme: nothing in any logo names a colour of its
   *  own. */
  test('and are drawn in the colour of the text around them, in either theme', async () => {
    const held = await brands()

    for (const { name } of held.entries) {
      const shape = held.shape(name)
      if (shape?.kind !== 'drawn') throw new Error(name)
      expect(shape.body, name).not.toMatch(/fill="#|stroke="#|fill="(?!currentColor|none)/)
    }
  })

  /** A slug squashes a name - `visualstudiocode` - so the brands people reach for most
   *  are found by what they are called, and by what else they go by. */
  test('are found by name, and by the other words a brand goes by', async () => {
    const held = await brands()

    expect(rankIcons(held.entries, 'github', 1)).toEqual(['github'])
    expect(rankIcons(held.entries, 'vs code', 4)).toContain('visualstudiocode')
    expect(rankIcons(held.entries, 'chatgpt', 4)).toContain('openai')
    expect(rankIcons(held.entries, 'claude code', 4)).toContain('claude')
    expect(rankIcons(held.entries, 'obs', 8)).toContain('obsstudio')
    expect(held.entries.find((one) => one.name === 'visualstudiocode')?.words).toBe(
      'visual studio code',
    )
  })

  /** For code that wants a company's mark by name: an AI chat's provider (#1089). */
  test('and code asks for one by its slug', () => {
    expect(brandIcon('claude')).toBe('simple-icons:claude')
    expect(readIcon(brandIcon('openai'))).toEqual({ kind: 'set', set: BRANDS, name: 'openai' })
  })

  /** Simple Icons gives the drawings away and says the marks are still their owners'. */
  test('credit the set, its licence and the owners of the marks', () => {
    const credit = setNamed(BRANDS)!.credit

    expect(credit).toContain('Simple Icons')
    expect(credit).toContain('CC0')
    expect(credit).toContain('trademarks')
    expect(pickerCredit()).toContain(credit)
  })

  /** #1096: Orden's own mark is a brand like the rest, one colour, found by its name. */
  test('hold Orden s own mark, drawn in the text s colour', async () => {
    const brands = await setNamed(BRANDS)!.load()

    expect(rankIcons(brands.entries, 'orden', 3)[0]).toBe(ORDEN)
    const drawn = brands.shape(ORDEN)
    expect(drawn?.kind).toBe('drawn')
    expect(drawn?.kind === 'drawn' && drawn.body).toContain('currentColor')
    expect(drawn?.kind === 'drawn' && drawn.box).toBe('0 0 24 24')
  })
})

/** Every emoji drawn again in one colour (#1097), offered in the emoji's own cells. */
describe('the emoji in one colour', () => {
  let held: LoadedSet | null = null
  const outlines = async () => (held ??= await setNamed(EMOJI_OUTLINE)!.load())

  /** Every emoji of every group, the flags, the newest and the families among them: the
   *  ones the set does not draw are drawn out of Noto at build time (emoji-outlines.ts). */
  test('draw every emoji, each by its own character', async () => {
    const set = await outlines()
    const emoji = await setNamed(EMOJI_SET)!.load()
    const every = emoji.groups.flatMap((one) => one.names)

    expect(every.length).toBeGreaterThan(1900)
    for (const one of every) expect(set.shape(set.twin?.(one) ?? '')?.kind, one).toBe('drawn')
    expect(set.twin?.('🤔')).toBe('thinking-face')
    expect(set.twin?.('❤️')).toBe('red-heart')
    // Filed under another name than its character.
    expect(set.twin?.('👉')).toBe('backhand-index-pointing-right')
    // Filed under `0023-20e3`, four digits a code point.
    expect(set.twin?.('#️⃣')).toBe('keycap-hashtag')
    // Drawn out of Noto, under the emoji's slug.
    expect(set.twin?.('🫩')).toBe('face-with-bags-under-eyes')
    expect(set.twin?.('🇨🇭')).toBe('flag-switzerland')
    expect(set.twin?.('👨‍👩‍👧‍👦')).toBe('family-man-woman-girl-boy')
    expect(set.twin?.('rocket')).toBeNull()
  })

  /** An alias is its parent's drawing as the alias says to draw it: 👉 is 👈 turned over,
   *  and was drawn pointing left. */
  test('draw an alias turned the way it says', async () => {
    const set = await outlines()
    const left = set.shape('backhand-index-pointing-left') as { body: string }
    const right = set.shape('backhand-index-pointing-right') as { body: string }

    expect(right.body).toBe(`<g transform="translate(32 0) scale(-1 1)">${left.body}</g>`)
  })

  /** The set's 😶‍🌫️ is clouds to every edge of its box, a square of noise in a cell. */
  test('draw again out of Noto what fills its box', async () => {
    const set = await outlines()

    for (const name of FILLS_ITS_BOX) {
      expect((set.shape(name) as { body: string }).body, name).toBe(notoOutlines()[name])
    }
  })

  /** Each glyph is fitted to the set's box, a unit inside its edges, as the set's own are. */
  test('fit what Noto draws into the box', () => {
    const drawn = Object.entries(notoOutlines())

    expect(drawn.length).toBeGreaterThan(300)
    for (const [name, body] of drawn) {
      expect(body, name).toMatch(/^<path fill="currentColor" d="M[^"]+Z"\/>$/)
      const numbers = (body.match(/-?\d*\.?\d+/g) ?? []).map(Number)
      expect(Math.min(...numbers), name).toBeGreaterThanOrEqual(0.9)
      expect(Math.max(...numbers), name).toBeLessThanOrEqual(31.1)
    }
  })

  /** A mask and a clip path are drawn in black and white to say what shows, which is no
   *  colour on screen; everything else is the text's. */
  test('are drawn in the text s colour alone, so a tint paints them', async () => {
    const set = await outlines()

    for (const { name } of set.entries) {
      const shape = set.shape(name)
      if (shape?.kind !== 'drawn') throw new Error(name)
      const shown = shape.body.replace(/<(mask|clipPath)\b.*?<\/\1>/g, '')
      expect(shown, name).not.toMatch(/(fill|stroke)="(?!currentColor"|none")/)
    }
  })

  /** Every drawing is inline in the one page, so an id two of them share is one
   *  drawing's mask cutting another. */
  test('keep the ids of their masks to themselves', async () => {
    const set = await outlines()
    const owners = new Map<string, string>()

    for (const { name } of set.entries) {
      const shape = set.shape(name)
      if (shape?.kind !== 'drawn') continue
      for (const [, id] of shape.body.matchAll(/\bid="([^"]+)"/g)) {
        const owner = owners.get(id!)
        // An alias is the same drawing under a second name.
        if (owner && set.shape(owner) !== shape) {
          if (shape.body !== (set.shape(owner) as { body: string }).body)
            throw new Error(`${id} in ${owner} and ${name}`)
        }
        owners.set(id!, name)
      }
      for (const [, id] of shape.body.matchAll(/url\(#([^)]+)\)/g))
        expect(shape.body, name).toContain(`id="${id}"`)
    }
  })

  test('are a value of their own, beside the emoji', () => {
    const value = writtenIcon(EMOJI_OUTLINE, 'thinking-face')

    expect(value).toBe('fluent-emoji-high-contrast:thinking-face')
    expect(readIcon(value)).toEqual({ kind: 'set', set: EMOJI_OUTLINE, name: 'thinking-face' })
    expect(readIcon('🤔')).toEqual({ kind: 'emoji', text: '🤔' })
  })

  test('are shown in one colour with the lines and the logos, where an emoji, a drawing and a site are not', () => {
    expect(inOneColour(readIcon('fluent-emoji-high-contrast:thinking-face'))).toBe(true)
    expect(inOneColour(readIcon('rocket'))).toBe(true)
    expect(inOneColour(readIcon('simple-icons:github'))).toBe(true)
    expect(inOneColour(readIcon('🤔'))).toBe(false)
    expect(inOneColour(readIcon('flat-color-icons:calendar'))).toBe(false)
    expect(inOneColour(readIcon('site:github.com'))).toBe(false)
  })

  test('take a tint as a line does, where an emoji, a drawing and a logo take none', () => {
    expect(takesTint(readIcon('fluent-emoji-high-contrast:thinking-face'))).toBe(true)
    expect(takesTint(readIcon('rocket'))).toBe(true)
    expect(takesTint(readIcon('🤔'))).toBe(false)
    expect(takesTint(readIcon('flat-color-icons:calendar'))).toBe(false)
    expect(takesTint(readIcon('simple-icons:github'))).toBe(false)
    expect(takesTint(null)).toBe(false)
  })

  test('credit Microsoft, Google and the licences', () => {
    const credit = setNamed(EMOJI_OUTLINE)!.credit

    expect(credit).toContain('Fluent Emoji High Contrast')
    expect(credit).toContain('MIT')
    expect(credit).toContain('Noto Emoji')
    expect(credit).toContain('OFL')
    expect(pickerCredit()).toContain(credit)
  })
})
