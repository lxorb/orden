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

  test('and by keywords that are nowhere in their names', async () => {
    const held = await setNamed(EMOJI_SET)!.load()

    expect(rankIcons(held.entries, 'launch', 4)).toContain('🚀')
    expect(rankIcons(held.entries, 'schedule', 4)).toContain('📅')
    expect(rankIcons(held.entries, 'date', 4)).toContain('📅')
    expect(rankIcons(held.entries, 'payment', 8)).toContain('💰')
  })

  test('and are called what Unicode calls them, once and no more', async () => {
    const held = await setNamed(EMOJI_SET)!.load()
    const rocket = held.entries.find((one) => one.name === '🚀')

    expect(rocket?.words).toBe('rocket')
    expect(rocket?.terms).toContain('launch')
  })

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

    expect(shape.body).toContain('<')
    expect(shape.box).toMatch(/^0 0 \d+ \d+$/)
    expect(shape.body).toMatch(/fill="#/)
  })

  test('has no groups, and every icon findable by its name', async () => {
    const held = await setNamed(FLAT_COLOUR)!.load()

    expect(held.groups).toEqual([])
    expect(held.entries.length).toBeGreaterThan(300)
    expect(rankIcons(held.entries, 'calendar', 4)).toContain('calendar')
  })

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

  test('and by what Lucide says each icon is for', async () => {
    const held = await setNamed(LUCIDE)!.load()

    expect(rankIcons(held.entries, 'math', 12)).toContain('Angle')
    expect(rankIcons(held.entries, 'garbage', 4)).toContain('Trash2')
    expect(rankIcons(held.entries, 'function', 4)).toContain('SquareFunction')
  })

  test('and by the other name the same drawing answers to', async () => {
    const held = await setNamed(LUCIDE)!.load()
    const alias = held.entries.find((one) => one.name === 'CircleAlert')

    expect(alias?.terms).toContain('alert circle')
    expect(alias?.words).toBe('circle alert')
  })

  test('and forgives a mistyped one without promoting it', async () => {
    const held = await setNamed(LUCIDE)!.load()

    expect(rankIcons(held.entries, 'calndar', 4)).toContain('Calendar')
    expect(rankIcons(held.entries, 'book', 4)[0]).toBe('Book')
  })

  test('and an empty query is still the library s own order', async () => {
    const held = await setNamed(LUCIDE)!.load()

    expect(rankIcons(held.entries, '', 3)).toEqual(held.entries.slice(0, 3).map((one) => one.name))
    expect(rankIcons(held.entries, '  ', 1)).toEqual(['AArrowDown'])
  })
})

describe('the sets the picker searches', () => {
  test('are every set, each once, the brands waiting for a search', () => {
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
    expect(names).toEqual(held.groups.flatMap((one) => one.names))
  })

  test('puts a drawing beside what it is about', async () => {
    const objects = (await merged()).groups.find((one) => one.label === 'Objects')!.names
    const at = (name: string) => objects.indexOf(name)

    const run = (emoji: string) => {
      const from = at(emoji) + 1
      let to = from
      while (objects[to]?.startsWith(`${FLAT_COLOUR}:`)) to++
      return objects.slice(from, to)
    }

    expect(run('📊')).toContain(`${FLAT_COLOUR}:pie-chart`)
    expect(run('📱')).toContain(`${FLAT_COLOUR}:sim-card`)
    const loose = LOOSE.Objects!.split(' ').map((name) => `${FLAT_COLOUR}:${name}`)
    expect([...objects.slice(-loose.length)].sort()).toEqual([...loose].sort())
  })

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

  test('and are drawn in the colour of the text around them, in either theme', async () => {
    const held = await brands()

    for (const { name } of held.entries) {
      const shape = held.shape(name)
      if (shape?.kind !== 'drawn') throw new Error(name)
      expect(shape.body, name).not.toMatch(/fill="#|stroke="#|fill="(?!currentColor|none)/)
    }
  })

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

  test('and code asks for one by its slug', () => {
    expect(brandIcon('claude')).toBe('simple-icons:claude')
    expect(readIcon(brandIcon('openai'))).toEqual({ kind: 'set', set: BRANDS, name: 'openai' })
  })

  test('credit the set, its licence and the owners of the marks', () => {
    const credit = setNamed(BRANDS)!.credit

    expect(credit).toContain('Simple Icons')
    expect(credit).toContain('CC0')
    expect(credit).toContain('trademarks')
    expect(pickerCredit()).toContain(credit)
  })

  test('hold Orden s own mark, drawn in the text s colour', async () => {
    const brands = await setNamed(BRANDS)!.load()

    expect(rankIcons(brands.entries, 'orden', 3)[0]).toBe(ORDEN)
    const drawn = brands.shape(ORDEN)
    expect(drawn?.kind).toBe('drawn')
    expect(drawn?.kind === 'drawn' && drawn.body).toContain('currentColor')
    expect(drawn?.kind === 'drawn' && drawn.box).toBe('0 0 24 24')
  })
})

describe('the emoji in one colour', () => {
  let held: LoadedSet | null = null
  const outlines = async () => (held ??= await setNamed(EMOJI_OUTLINE)!.load())

  test('draw every emoji, each by its own character', async () => {
    const set = await outlines()
    const emoji = await setNamed(EMOJI_SET)!.load()
    const every = emoji.groups.flatMap((one) => one.names)

    expect(every.length).toBeGreaterThan(1900)
    for (const one of every) expect(set.shape(set.twin?.(one) ?? '')?.kind, one).toBe('drawn')
    expect(set.twin?.('🤔')).toBe('thinking-face')
    expect(set.twin?.('❤️')).toBe('red-heart')
    expect(set.twin?.('👉')).toBe('backhand-index-pointing-right')
    expect(set.twin?.('#️⃣')).toBe('keycap-hashtag')
    expect(set.twin?.('🫩')).toBe('face-with-bags-under-eyes')
    expect(set.twin?.('🇨🇭')).toBe('flag-switzerland')
    expect(set.twin?.('👨‍👩‍👧‍👦')).toBe('family-man-woman-girl-boy')
    expect(set.twin?.('rocket')).toBeNull()
  })

  test('draw an alias turned the way it says', async () => {
    const set = await outlines()
    const left = set.shape('backhand-index-pointing-left') as { body: string }
    const right = set.shape('backhand-index-pointing-right') as { body: string }

    expect(right.body).toBe(`<g transform="translate(32 0) scale(-1 1)">${left.body}</g>`)
  })

  test('draw again out of Noto what fills its box', async () => {
    const set = await outlines()

    for (const name of FILLS_ITS_BOX) {
      expect((set.shape(name) as { body: string }).body, name).toBe(notoOutlines()[name])
    }
  })

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

  test('are drawn in the text s colour alone, so a tint paints them', async () => {
    const set = await outlines()

    for (const { name } of set.entries) {
      const shape = set.shape(name)
      if (shape?.kind !== 'drawn') throw new Error(name)
      const shown = shape.body.replace(/<(mask|clipPath)\b.*?<\/\1>/g, '')
      expect(shown, name).not.toMatch(/(fill|stroke)="(?!currentColor"|none")/)
    }
  })

  test('keep the ids of their masks to themselves', async () => {
    const set = await outlines()
    const owners = new Map<string, string>()

    for (const { name } of set.entries) {
      const shape = set.shape(name)
      if (shape?.kind !== 'drawn') continue
      for (const [, id] of shape.body.matchAll(/\bid="([^"]+)"/g)) {
        const owner = owners.get(id!)
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
