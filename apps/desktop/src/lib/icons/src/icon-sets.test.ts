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
} from '../../ui-kit/src/api'
import { notoOutlines } from '../../../../emoji-outlines'
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

const load = (id: string) => setNamed(id)!.load()
const labels = (held: Pick<LoadedSet, 'groups'>) => held.groups.map((one) => one.label)
function finds(held: Pick<LoadedSet, 'entries'>, cases: [query: string, limit: number, name: string][]) {
  for (const [query, limit, name] of cases) {
    expect(rankIcons(held.entries, query, limit), query).toContain(name)
  }
}
function drawn(held: LoadedSet, name: string) {
  const shape = held.shape(name)
  if (shape?.kind !== 'drawn') throw new Error(name)
  return shape
}
describe('the sets an icon can come from', () => {
  test('are the six the picker offers, each named, with an id nothing else uses', () => {
    expect(ICON_SETS.map((one) => one.id)).toEqual([LUCIDE, EMOJI_SET, FLAT_COLOUR, EMOJI_OUTLINE, SITE_ICONS, BRANDS])
    expect(new Set(ICON_SETS.map((one) => one.id)).size).toBe(ICON_SETS.length)
    for (const set of ICON_SETS) expect(set.label, set.id).toBeTruthy()
  })
  test('a set of drawings says who drew it and under what licence, and a set nothing knows is nothing', () => {
    expect(setNamed(LUCIDE)?.credit).toContain('ISC')
    expect(setNamed(FLAT_COLOUR)?.credit).toContain('MIT')
    expect(setNamed(EMOJI_SET)?.credit).toBe('')
    expect(setNamed('some-future-set')).toBeNull()
  })
})
describe('the emoji', () => {
  test('are the whole set, in Unicode s own nine groups, one entry per emoji with no skin tone', async () => {
    const held = await load(EMOJI_SET)
    expect(labels(held)).toEqual([
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
    expect(held.groups.reduce((count, one) => count + one.names.length, 0)).toBe(held.entries.length)
    expect(held.entries.length).toBeGreaterThan(1500)
    const tones = ['🏻', '🏼', '🏽', '🏾', '🏿']
    expect(held.entries.filter((one) => tones.some((tone) => one.name.includes(tone)))).toEqual([])
    expect(held.shape('🚀')).toEqual({ kind: 'emoji', text: '🚀' })
  })
  test('are findable by the words a person would type, and keywords nowhere in their names', async () => {
    const held = await load(EMOJI_SET)
    finds(held, [
      ['rocket', 4, '🚀'],
      ['money bag', 4, '💰'],
      ['calendar', 8, '📅'],
      ['launch', 4, '🚀'],
      ['schedule', 4, '📅'],
      ['date', 4, '📅'],
      ['payment', 8, '💰'],
    ])
    const rocket = held.entries.find((one) => one.name === '🚀')
    expect(rocket?.words).toBe('rocket')
    expect(rocket?.terms).toContain('launch')
  })
})
describe('a coloured set', () => {
  test('is finished drawings in the box they were drawn in, with no groups, every icon findable', async () => {
    const held = await load(FLAT_COLOUR)
    const shape = drawn(held, 'calendar')
    expect(shape.body).toContain('<')
    expect(shape.box).toMatch(/^0 0 \d+ \d+$/)
    expect(shape.body).toMatch(/fill="#/)
    expect(held.groups).toEqual([])
    expect(held.entries.length).toBeGreaterThan(300)
    finds(held, [
      ['calendar', 4, 'calendar'],
      ['directory', 4, 'folder'],
      ['birthday', 4, 'calendar'],
      ['work', 4, 'briefcase'],
    ])
    expect(held.shape('not-an-icon-anybody-drew')).toBeNull()
  })
  test.each([FLAT_COLOUR, LUCIDE])('and %s holds no icon named after an object property', async (id) => {
    const held = await load(id)
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(held.shape(name)).toBeNull()
    }
  })
})
describe('the stroked set', () => {
  test('is strokes this app dresses, found by its words, its uses and its other names', async () => {
    const held = await load(LUCIDE)
    expect(held.shape('Rocket')?.kind).toBe('stroked')
    expect(held.groups).toEqual([])
    expect(held.entries.length).toBeGreaterThan(1000)
    finds(held, [
      ['book open', 4, 'BookOpen'],
      ['math', 12, 'Angle'],
      ['garbage', 4, 'Trash2'],
      ['function', 4, 'SquareFunction'],
      ['calndar', 4, 'Calendar'],
    ])
    const alias = held.entries.find((one) => one.name === 'CircleAlert')
    expect(alias?.terms).toContain('alert circle')
    expect(alias?.words).toBe('circle alert')
    expect(rankIcons(held.entries, 'book', 4)[0]).toBe('Book')
    expect(rankIcons(held.entries, '', 3)).toEqual(held.entries.slice(0, 3).map((one) => one.name))
    expect(rankIcons(held.entries, '  ', 1)).toEqual(['AArrowDown'])
  })
})
describe('the sets the picker searches', () => {
  test('are every set, each once, the brands waiting for a search, each credited', () => {
    expect([...PICKER_SETS, EMOJI_OUTLINE, SITE_ICONS].sort()).toEqual(ICON_SETS.map((one) => one.id).sort())
    expect(new Set(PICKER_SETS).size).toBe(PICKER_SETS.length)
    expect([...LATER_SETS]).toEqual([BRANDS])
    for (const set of ICON_SETS) expect(pickerCredit()).toContain(set.credit)
  })
  test('are one list: the emoji s groups, then the line icons and the brands', async () => {
    const held = mergeSets(await Promise.all(PICKER_SETS.map(async (id) => ({ id, held: await load(id) }))))
    expect(labels(held).slice(-2)).toEqual(['Line', 'Brands'])
    expect(new Set(held.entries.map((one) => one.name)).size).toBe(held.entries.length)
    finds(held, [
      ['rocket', 20, 'rocket'],
      ['rocket', 20, '🚀'],
    ])
  })
})
describe('the places of the coloured drawings among the emoji', () => {
  test('name every drawing exactly once, beside emoji and in groups that exist', async () => {
    const [emoji, flat] = await Promise.all([load(EMOJI_SET), load(FLAT_COLOUR)])
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
    for (const group of Object.keys(LOOSE)) expect(labels(emoji)).toContain(group)
  })
})
describe('the picture tab', () => {
  test('is the emoji s groups with the drawings in them, every icon once, searched as one', async () => {
    const held = mergeSets(
      await Promise.all([EMOJI_SET, FLAT_COLOUR].map(async (id) => ({ id, held: await load(id) }))),
    )
    const names = held.entries.map((one) => one.name)
    expect(labels(held)).toEqual(labels(await load(EMOJI_SET)))
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(held.groups.flatMap((one) => one.names))
    const objects = held.groups.find((one) => one.label === 'Objects')!.names
    const run = (emoji: string) => {
      const from = objects.indexOf(emoji) + 1
      let to = from
      while (objects[to]?.startsWith(`${FLAT_COLOUR}:`)) to++
      return objects.slice(from, to)
    }
    expect(run('📊')).toContain(`${FLAT_COLOUR}:pie-chart`)
    expect(run('📱')).toContain(`${FLAT_COLOUR}:sim-card`)
    const loose = LOOSE.Objects!.split(' ').map((name) => `${FLAT_COLOUR}:${name}`)
    expect([...objects.slice(-loose.length)].sort()).toEqual([...loose].sort())
    for (const name of Object.keys(SAME)) expect(names).not.toContain(`${FLAT_COLOUR}:${name}`)
    expect(names).toContain('📅')
    finds(held, [
      ['calendar', 2, '📅'],
      ['rocket', 4, '🚀'],
      ['pie chart', 4, `${FLAT_COLOUR}:pie-chart`],
      ['directory', 8, '📁'],
    ])
    expect((await load(FLAT_COLOUR)).shape('calendar')?.kind).toBe('drawn')
  })
})
describe('merging sets', () => {
  const set = (names: string[], groups: LoadedSet['groups'] = []): LoadedSet => ({
    entries: names.map((name) => ({ name, words: name })),
    groups,
    shape: () => null,
  })
  test('keeps an icon whose place is nowhere, and without a frame is the sets one after another', () => {
    const frame = set(['a', 'b'], [{ label: 'Letters', names: ['a', 'b'] }])
    const extra = {
      ...set(['x', 'y']),
      place: (name: string) => (name === 'x' ? { after: 'a' } : null),
    }
    expect(
      mergeSets([
        { id: EMOJI_SET, held: frame },
        { id: 'later', held: extra },
      ]).groups,
    ).toEqual([
      { label: 'Letters', names: ['a', 'later:x', 'b'] },
      { label: 'later', names: ['later:y'] },
    ])
    const held = mergeSets([{ id: LUCIDE, held: set(['BookOpen']) }])
    expect(held.groups).toEqual([])
    expect(held.entries.map((one) => one.name)).toEqual(['book-open'])
  })
})
describe('the brands', () => {
  test('are every logo Simple Icons draws, in the colour of the text, found by name and other words', async () => {
    const held = await load(BRANDS)
    expect(held.entries.length).toBeGreaterThan(3000)
    expect(held.groups).toEqual([])
    for (const slug of 'blender obsstudio anthropic claude openai youtube linkedin github google discord slack spotify figma notion visualstudiocode'.split(
      ' ',
    )) {
      expect(held.shape(slug)?.kind, slug).toBe('drawn')
    }
    for (const { name } of held.entries) {
      expect(drawn(held, name).body, name).not.toMatch(/fill="#|stroke="#|fill="(?!currentColor|none)/)
    }
    expect(rankIcons(held.entries, 'github', 1)).toEqual(['github'])
    finds(held, [
      ['vs code', 4, 'visualstudiocode'],
      ['chatgpt', 4, 'openai'],
      ['claude code', 4, 'claude'],
      ['obs', 8, 'obsstudio'],
    ])
    expect(held.entries.find((one) => one.name === 'visualstudiocode')?.words).toBe('visual studio code')
    expect(rankIcons(held.entries, 'orden', 3)[0]).toBe(ORDEN)
    const mark = drawn(held, ORDEN)
    expect(mark.body).toContain('currentColor')
    expect(mark.box).toBe('0 0 24 24')
  })
  test('are asked for by slug, and credit the set, its licence and the owners of the marks', () => {
    expect(brandIcon('claude')).toBe('simple-icons:claude')
    expect(readIcon(brandIcon('openai'))).toEqual({ kind: 'set', set: BRANDS, name: 'openai' })
    const credit = setNamed(BRANDS)!.credit
    for (const part of ['Simple Icons', 'CC0', 'trademarks']) expect(credit).toContain(part)
    expect(pickerCredit()).toContain(credit)
  })
})
describe('the emoji in one colour', () => {
  test('draw every emoji, each by its own character, an alias turned, Noto where it fills the box', async () => {
    const set = await load(EMOJI_OUTLINE)
    const every = (await load(EMOJI_SET)).groups.flatMap((one) => one.names)
    expect(every.length).toBeGreaterThan(1900)
    for (const one of every) expect(set.shape(set.twin?.(one) ?? '')?.kind, one).toBe('drawn')
    for (const [emoji, name] of [
      ['🤔', 'thinking-face'],
      ['❤️', 'red-heart'],
      ['👉', 'backhand-index-pointing-right'],
      ['#️⃣', 'keycap-hashtag'],
      ['🫩', 'face-with-bags-under-eyes'],
      ['🇨🇭', 'flag-switzerland'],
      ['👨‍👩‍👧‍👦', 'family-man-woman-girl-boy'],
    ]) {
      expect(set.twin?.(emoji!)).toBe(name)
    }
    expect(set.twin?.('rocket')).toBeNull()
    expect(drawn(set, 'backhand-index-pointing-right').body).toBe(
      `<g transform="translate(32 0) scale(-1 1)">${drawn(set, 'backhand-index-pointing-left').body}</g>`,
    )
    for (const name of FILLS_ITS_BOX) expect(drawn(set, name).body, name).toBe(notoOutlines()[name])
  })
  test('fit what Noto draws into the box', () => {
    const outlines = Object.entries(notoOutlines())
    expect(outlines.length).toBeGreaterThan(300)
    for (const [name, body] of outlines) {
      expect(body, name).toMatch(/^<path fill="currentColor" d="M[^"]+Z"\/>$/)
      const numbers = (body.match(/-?\d*\.?\d+/g) ?? []).map(Number)
      expect(Math.min(...numbers), name).toBeGreaterThanOrEqual(0.9)
      expect(Math.max(...numbers), name).toBeLessThanOrEqual(31.1)
    }
  })
  test('are drawn in the text s colour alone, and keep the ids of their masks to themselves', async () => {
    const set = await load(EMOJI_OUTLINE)
    const owners = new Map<string, string>()
    for (const { name } of set.entries) {
      const shape = drawn(set, name)
      expect(shape.body.replace(/<(mask|clipPath)\b.*?<\/\1>/g, ''), name).not.toMatch(
        /(fill|stroke)="(?!currentColor"|none")/,
      )
      for (const [, id] of shape.body.matchAll(/\bid="([^"]+)"/g)) {
        const owner = owners.get(id!)
        if (owner && set.shape(owner) !== shape && shape.body !== drawn(set, owner).body) {
          throw new Error(`${id} in ${owner} and ${name}`)
        }
        owners.set(id!, name)
      }
      for (const [, id] of shape.body.matchAll(/url\(#([^)]+)\)/g)) expect(shape.body, name).toContain(`id="${id}"`)
    }
  })
  test('are a value of their own beside the emoji, in one colour and tinted as a line is', () => {
    const value = writtenIcon(EMOJI_OUTLINE, 'thinking-face')
    expect(value).toBe('fluent-emoji-high-contrast:thinking-face')
    expect(readIcon(value)).toEqual({ kind: 'set', set: EMOJI_OUTLINE, name: 'thinking-face' })
    expect(readIcon('🤔')).toEqual({ kind: 'emoji', text: '🤔' })
    for (const [icon, oneColour, tint] of [
      ['fluent-emoji-high-contrast:thinking-face', true, true],
      ['rocket', true, true],
      ['simple-icons:github', true, false],
      ['🤔', false, false],
      ['flat-color-icons:calendar', false, false],
      ['site:github.com', false, null],
    ] as const) {
      expect(inOneColour(readIcon(icon)), icon).toBe(oneColour)
      if (tint !== null) expect(takesTint(readIcon(icon)), icon).toBe(tint)
    }
    expect(takesTint(null)).toBe(false)
  })
  test('credit Microsoft, Google and the licences', () => {
    const credit = setNamed(EMOJI_OUTLINE)!.credit
    for (const part of ['Fluent Emoji High Contrast', 'MIT', 'Noto Emoji', 'OFL']) {
      expect(credit).toContain(part)
    }
    expect(pickerCredit()).toContain(credit)
  })
})
