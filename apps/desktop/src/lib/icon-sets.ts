import { siteIconSet } from './web-tab/src/api'
import {
  BRANDS,
  EMOJI_OUTLINE,
  EMOJI_SET,
  type IconEntry,
  type IconNode,
  loadIcons,
  LUCIDE,
  SITE_ICONS,
  squash,
  writtenIcon,
} from './ui-kit/src/api'
import { outlineName, plain } from './outline-names'

let tagged: Map<string, string> | null = null

async function loadTags(): Promise<Map<string, string>> {
  if (tagged) return tagged

  const found = new Map<string, string>()

  try {
    const tags = (await import('lucide-static/tags.json')).default as Record<string, string[]>
    for (const [name, words] of Object.entries(tags)) {
      found.set(squash(name), words.join(' ').toLowerCase())
    }
  } catch {
    // The plugin build leaves the file out and a chunk can fail to arrive. Either way
    // every set still loads: an icon found by its name alone is the picker as it was,
    // and a picker that would not open because a list of search words was missing is
    // a picker as it never was.
  }

  tagged = found
  return found
}

export type IconShape =
  | { kind: 'emoji'; text: string }
  | { kind: 'stroked'; icon: IconNode }
  | { kind: 'drawn'; body: string; box: string }
  | { kind: 'picture'; src: string }

export interface LoadedSet {
  entries: IconEntry[]
  groups: { label: string; names: string[] }[]
  shape(name: string): IconShape | null
  place?(name: string): IconPlace | null
  twin?(emoji: string): string | null
  readonly unoffered?: boolean
}

export type IconPlace = { same: string } | { after: string } | { group: string }

export interface IconSet {
  id: string
  label: string
  credit: string
  load(): Promise<LoadedSet>
}

interface EmojiGroup {
  name: string
  slug: string
  emojis: { emoji: string; name: string; slug: string }[]
}

async function loadEmojiWords(): Promise<Map<string, string>> {
  const said = new Map<string, string[]>()

  try {
    const listed = (await import('emojilib/emojis.json')).default as Record<
      string,
      { char?: string; keywords?: string[] }
    >

    for (const [shortcode, one] of Object.entries(listed)) {
      if (!one.char) continue

      const found = said.get(plain(one.char)) ?? []
      found.push(...(one.keywords ?? []), shortcode)
      said.set(plain(one.char), found)
    }
  } catch {
    // The plugin leaves the emoji out altogether, so this never runs there; and a
    // chunk that will not arrive costs the keywords rather than the set.
  }

  return new Map(
    [...said].map(([char, words]) => [
      char,
      [
        ...new Set(
          words.map((word) =>
            word
              .replace(/[^a-z\d]+/gi, ' ')
              .trim()
              .toLowerCase(),
          ),
        ),
      ].join(' '),
    ]),
  )
}

async function loadEmoji(): Promise<LoadedSet> {
  const [groups, said] = await Promise.all([
    import('unicode-emoji-json/data-by-group.json'),
    loadEmojiWords(),
  ])

  const entries: IconEntry[] = []
  const shown: { label: string; names: string[] }[] = []

  for (const group of groups.default as EmojiGroup[]) {
    const names: string[] = []

    for (const one of group.emojis) {
      entries.push({
        name: one.emoji,
        words: one.name.toLowerCase(),
        terms: `${one.slug.replace(/_/g, ' ')} ${said.get(plain(one.emoji)) ?? ''}`.trim(),
      })
      names.push(one.emoji)
    }

    shown.push({ label: group.name, names })
  }

  return {
    entries,
    groups: shown,
    shape: (name) => ({ kind: 'emoji', text: name }),
  }
}

export async function tonedEmoji(): Promise<Set<string>> {
  const groups = (await import('unicode-emoji-json/data-by-group.json')).default as Toned[]
  return new Set(
    groups.flatMap((group) =>
      group.emojis.filter((one) => one.skin_tone_support).map((one) => one.emoji),
    ),
  )
}

interface Toned {
  emojis: { emoji: string; skin_tone_support: boolean }[]
}

async function loadLucide(): Promise<LoadedSet> {
  const [library, tags] = await Promise.all([loadIcons(), loadTags()])

  const alike = new Map<IconNode, string[]>()
  for (const [name, icon] of Object.entries(library)) {
    const named = alike.get(icon)
    if (named) named.push(name)
    else alike.set(icon, [name])
  }

  const terms = new Map<string, string>()
  for (const named of alike.values()) {
    const said = [...new Set(named.flatMap((one) => tags.get(squash(one)) ?? []))]

    for (const name of named) {
      terms.set(name, [...named.filter((one) => one !== name).map(spaced), ...said].join(' '))
    }
  }

  return {
    entries: Object.keys(library).map((name) => ({
      name,
      words: spaced(name),
      terms: terms.get(name) ?? '',
    })),
    groups: [],
    shape: (name) => {
      const icon = library[name]
      return icon ? { kind: 'stroked', icon } : null
    },
  }
}

interface IconifyCollection {
  icons: Record<string, { body: string; width?: number; height?: number }>
  width?: number
  height?: number
}

function iconify(collection: IconifyCollection, tags: Map<string, string>): LoadedSet {
  const wide = collection.width ?? 24
  const tall = collection.height ?? 24

  return {
    entries: Object.keys(collection.icons).map((name) => ({
      name,
      words: spaced(name),
      terms: tags.get(squash(name)) ?? '',
    })),
    groups: [],
    shape: (name) => {
      const icon = collection.icons[name]
      if (!icon) return null

      return {
        kind: 'drawn',
        body: icon.body,
        box: `0 0 ${icon.width ?? wide} ${icon.height ?? tall}`,
      }
    },
  }
}

async function loadFlatColour(): Promise<LoadedSet> {
  const [collection, tags, places] = await Promise.all([
    import('@iconify-json/flat-color-icons/icons.json'),
    loadTags(),
    import('./flat-colour-places'),
  ])

  const placed = new Map<string, IconPlace>()
  for (const [name, emoji] of Object.entries(places.SAME)) placed.set(name, { same: emoji })
  for (const [emoji, names] of Object.entries(places.BESIDE)) {
    for (const name of names.split(' ')) placed.set(name, { after: emoji })
  }
  for (const [group, names] of Object.entries(places.LOOSE)) {
    for (const name of names.split(' ')) placed.set(name, { group })
  }

  return { ...iconify(collection.default, tags), place: (name) => placed.get(name) ?? null }
}

interface Aliased extends IconifyCollection {
  aliases?: Record<string, { parent: string; hFlip?: boolean; vFlip?: boolean }>
}

function flipped(body: string, wide: number, tall: number, h: boolean, v: boolean): string {
  if (!h && !v) return body
  return `<g transform="translate(${h ? wide : 0} ${v ? tall : 0}) scale(${h ? -1 : 1} ${v ? -1 : 1})">${body}</g>`
}

function ownIds(body: string, name: string): string {
  const ids = [...body.matchAll(/\bid="([^"]+)"/g)].flatMap((one) => (one[1] ? [one[1]] : []))
  return ids.reduce(
    (out: string, id) =>
      out
        .replaceAll(`id="${id}"`, `id="${id}-${name}"`)
        .replaceAll(`url(#${id})`, `url(#${id}-${name})`)
        .replaceAll(`href="#${id}"`, `href="#${id}-${name}"`),
    body,
  )
}

async function loadOutlines(): Promise<LoadedSet> {
  const [collection, chars, groups, noto] = await Promise.all([
    import('@iconify-json/fluent-emoji-high-contrast/icons.json'),
    import('@iconify-json/fluent-emoji-high-contrast/chars.json'),
    import('unicode-emoji-json/data-by-group.json'),
    import('virtual:noto-outlines'),
  ])
  const set = collection.default as Aliased
  const wide = set.width ?? 16
  const tall = set.height ?? 16
  const icons: IconifyCollection['icons'] = Object.fromEntries(
    Object.entries(set.icons).map(([name, icon]) => [
      name,
      { ...icon, body: ownIds(icon.body, name) },
    ]),
  )
  for (const [name, alias] of Object.entries(set.aliases ?? {})) {
    const parent = icons[alias.parent]
    if (!parent) continue
    const body = flipped(
      parent.body,
      parent.width ?? wide,
      parent.height ?? tall,
      !!alias.hFlip,
      !!alias.vFlip,
    )
    icons[name] = { ...parent, body }
  }
  for (const [name, body] of Object.entries(noto.default)) icons[name] = { body }
  const held = iconify({ ...set, icons }, new Map())
  const named = chars.default as Record<string, string>

  const twins = new Map<string, string>()
  for (const group of groups.default as EmojiGroup[]) {
    for (const one of group.emojis) {
      const name = outlineName(one.emoji, one.slug, named)
      if (icons[name]) twins.set(one.emoji, name)
    }
  }

  return { ...held, twin: (emoji) => twins.get(emoji) ?? null }
}

export const ORDEN = 'orden'

const ORDEN_MARK = {
  body:
    '<g fill="currentColor">' +
    '<rect x="0" y="0" width="16.82" height="6.18" rx="1.45"/>' +
    '<rect x="17.82" y="0" width="6.18" height="16.82" rx="1.45"/>' +
    '<rect x="0" y="7.18" width="6.18" height="16.82" rx="1.45"/>' +
    '<rect x="7.18" y="17.82" width="16.82" height="6.18" rx="1.45"/>' +
    '</g>',
  width: 24,
  height: 24,
}

async function loadBrands(): Promise<LoadedSet> {
  const [collection, names] = await Promise.all([
    import('@iconify-json/simple-icons/icons.json'),
    import('./brand-names'),
  ])
  const set = collection.default as IconifyCollection
  const held = iconify({ ...set, icons: { ...set.icons, [ORDEN]: ORDEN_MARK } }, new Map())

  return {
    ...held,
    entries: held.entries.map((one) => ({
      name: one.name,
      words: (names.CALLED[one.name] ?? one.name).toLowerCase(),
      terms: [one.name, names.ALSO[one.name] ?? ''].join(' ').trim(),
    })),
  }
}

function spaced(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
}

export const DEFAULT_SET = LUCIDE

export const FLAT_COLOUR = 'flat-color-icons'

export const ICON_SETS: readonly IconSet[] = [
  {
    id: LUCIDE,
    label: 'Line',
    credit: 'Lucide, ISC',
    load: loadLucide,
  },
  {
    id: EMOJI_SET,
    label: 'Emoji',
    credit: '',
    load: loadEmoji,
  },
  {
    id: FLAT_COLOUR,
    label: 'Colour',
    credit: 'Flat Color Icons by Icons8, MIT',
    load: loadFlatColour,
  },
  {
    id: EMOJI_OUTLINE,
    label: 'One colour',
    credit: 'Fluent Emoji High Contrast by Microsoft, MIT; Noto Emoji by Google, OFL 1.1',
    load: loadOutlines,
  },
  {
    id: SITE_ICONS,
    label: 'Web icons',
    credit: '',
    load: async () => (await siteIconSet()).siteSet(),
  },
  {
    id: BRANDS,
    label: 'Brands',
    credit: 'Simple Icons, CC0 1.0. Brand names and logos are trademarks of their owners',
    load: loadBrands,
  },
]

export function setNamed(id: string): IconSet | null {
  return ICON_SETS.find((one) => one.id === id) ?? null
}

export const PICKER_SETS: readonly string[] = [EMOJI_SET, FLAT_COLOUR, LUCIDE, BRANDS]

export const LATER_SETS: ReadonlySet<string> = new Set([BRANDS])

export function pickerCredit(): string {
  return [...PICKER_SETS, EMOJI_OUTLINE]
    .map((id) => setNamed(id)?.credit ?? '')
    .filter(Boolean)
    .join('; ')
}

export interface TabHeld {
  entries: IconEntry[]
  groups: { label: string; names: string[] }[]
}

export function mergeSets(parts: readonly { id: string; held: LoadedSet }[]): TabHeld {
  const frame = parts.find((part) => part.held.groups.length)
  const entries = new Map<string, IconEntry>()
  const after = new Map<string, string[]>()
  const ends = new Map<string, string[]>()
  const groups =
    frame?.held.groups.map((group) => ({
      label: group.label,
      names: group.names.map((name) => writtenIcon(frame.id, name)),
    })) ?? []
  const labels = new Set(groups.map((group) => group.label))

  const push = (map: Map<string, string[]>, key: string, written: string) => {
    const held = map.get(key)
    if (held) held.push(written)
    else map.set(key, [written])
  }

  for (const part of [...(frame ? [frame] : []), ...parts.filter((one) => one !== frame)]) {
    const unplaced: string[] = []

    for (const one of part.held.entries) {
      const written = writtenIcon(part.id, one.name)
      if (entries.has(written)) continue

      if (!frame || part === frame) {
        entries.set(written, { ...one, name: written })
        continue
      }

      const place = part.held.place?.(one.name) ?? null
      const anchor =
        place && !('group' in place)
          ? writtenIcon(frame.id, 'same' in place ? place.same : place.after)
          : null
      const twin = anchor === null ? undefined : entries.get(anchor)

      if (place && 'same' in place && twin) {
        const terms = [twin.terms, one.words, one.terms].filter(Boolean).join(' ')
        entries.set(twin.name, { ...twin, terms })
        continue
      }

      entries.set(written, { ...one, name: written })

      if (anchor !== null && twin) push(after, anchor, written)
      else if (place && 'group' in place && labels.has(place.group))
        push(ends, place.group, written)
      else unplaced.push(written)
    }

    if (frame && unplaced.length) {
      groups.push({ label: setNamed(part.id)?.label ?? part.id, names: unplaced })
    }
  }

  if (!frame) return { entries: [...entries.values()], groups }

  const shown = groups.map((group) => ({
    label: group.label,
    names: [
      ...group.names.flatMap((name) => [name, ...(after.get(name) ?? [])]),
      ...(ends.get(group.label) ?? []),
    ],
  }))

  return {
    entries: shown.flatMap((group) => group.names.flatMap((name) => entries.get(name) ?? [])),
    groups: shown,
  }
}
