/** The sets an icon can come from, and the data behind each one.
 *
 *  Three, and each earns its place by answering something the others cannot:
 *
 *  - **Emoji.** The whole Unicode set, drawn by the platform's own colour font. The
 *    breadth is the point - there is an emoji for very nearly anything somebody
 *    would name a folder after - and the drawings cost nothing to ship, because
 *    every phone and every desktop already has them. What is shipped is the index
 *    that makes them findable: the name and the group of each, which is what turns
 *    a wall of pictures into something you can type "money" into.
 *  - **Lucide.** The stroked set the interface itself is drawn in, so an icon
 *    chosen here sits in a list beside the app's own marks without looking
 *    borrowed. Monochrome, and the one set a tint applies to; see icons.ts.
 *  - **Flat Color Icons.** Everyday objects drawn flat and in colour - a calendar,
 *    a folder, a graph, a suitcase. Icons8's set, MIT, 329 of them in 166 KB, which
 *    is small enough to be a set rather than a download. Where Lucide is a line and
 *    an emoji is a face, this is the drawing you would put on a filing cabinet.
 *
 *  Two coloured sets with real breadth were weighed and refused on size: Twemoji
 *  (10.5 MB, CC-BY-4.0) and Fluent Emoji Flat (9.2 MB, MIT) both redraw the emoji
 *  the platform font already draws in colour, and Iconify's brand set (7.6 MB,
 *  CC0-1.0) is nine megabytes of other people's trademarks. Nothing here is worth
 *  nine megabytes when the same picture is already on the device.
 *
 *  Every set is fetched the first time somebody opens its tab, once however often
 *  it is asked for, and from the app's own build - never from a CDN, which would
 *  make a private notes app phone a stranger to draw a folder. See
 *  icon-library.svelte.ts, which holds what has arrived, and the bundle test, which
 *  holds the sets out of the first chunk and out of the plugin. */

import { EMOJI_SET, type IconEntry, type IconNode, loadIcons, LUCIDE } from './icons'
import { key } from './i18n.svelte'

/** How a set is drawn, once its data is here.
 *
 *  Three shapes because there are three honest ways to put a picture on screen: a
 *  character the font draws, a stroked path this app dresses itself, and somebody
 *  else's finished drawing that has to be left exactly as it was. Nothing is gained
 *  by pretending the three are one. */
export type IconShape =
  | { kind: 'emoji'; text: string }
  | { kind: 'stroked'; icon: IconNode }
  /** A finished drawing: the elements of an SVG, and the box they were drawn in. */
  | { kind: 'drawn'; body: string; box: string }

/** What a loaded set holds. */
export interface LoadedSet {
  entries: IconEntry[]
  /** The groups the picker offers under the search field, in the set's own order.
   *  Empty for a set that has none, which is every set but the emoji. */
  groups: { label: string; names: string[] }[]
  shape(name: string): IconShape | null
}

/** One set as the picker knows it before anything is loaded. */
export interface IconSet {
  id: string
  /** What its tab says, marked for translation and translated where it is drawn. */
  label: string
  /** Who drew it and under what licence, for the credits; empty for the emoji,
   *  which nobody here drew and nobody here ships. */
  credit: string
  load(): Promise<LoadedSet>
}

/** The emoji index, as `unicode-emoji-json` publishes it: nine groups in Unicode's
 *  own order, each holding the base emoji of that group with the name Unicode gives
 *  it.
 *
 *  Base emoji only, which is the folding the requirement asks for: the file lists
 *  one entry per emoji with a flag saying whether it takes a skin tone, rather than
 *  five entries for five tones. A picker with five of every person in it is a
 *  picker nobody can find anything in. */
interface EmojiGroup {
  name: string
  slug: string
  emojis: { emoji: string; name: string; slug: string }[]
}

async function loadEmoji(): Promise<LoadedSet> {
  const groups = (await import('unicode-emoji-json/data-by-group.json')).default as EmojiGroup[]

  const entries: IconEntry[] = []
  const shown: { label: string; names: string[] }[] = []

  for (const group of groups) {
    const names: string[] = []

    for (const one of group.emojis) {
      // The slug as well as the name: `smiling_face_with_heart_eyes` holds words
      // the name spells the same way, but a search for "heart" should find it
      // whichever of the two the person was thinking of.
      entries.push({ name: one.emoji, words: `${one.name} ${one.slug.replace(/_/g, ' ')}` })
      names.push(one.emoji)
    }

    // Unicode's own group names, which are already the words a person would use.
    shown.push({ label: group.name, names })
  }

  return {
    entries,
    groups: shown,
    shape: (name) => ({ kind: 'emoji', text: name }),
  }
}

async function loadLucide(): Promise<LoadedSet> {
  const library = await loadIcons()

  return {
    entries: Object.keys(library).map((name) => ({ name, words: spaced(name) })),
    groups: [],
    shape: (name) => {
      const icon = library[name]
      return icon ? { kind: 'stroked', icon } : null
    },
  }
}

/** An Iconify collection, which is the shape every one of them ships in: a map of
 *  name to the elements of the drawing, and the box they were all drawn in. */
interface IconifyCollection {
  icons: Record<string, { body: string; width?: number; height?: number }>
  width?: number
  height?: number
}

/** One Iconify collection as a set. Ten lines rather than a dependency: the format
 *  is a body and a box, and drawing it is putting the body in an `<svg>` of that
 *  box. A library to do that would be a library to concatenate two strings. */
function iconify(collection: IconifyCollection): LoadedSet {
  const wide = collection.width ?? 24
  const tall = collection.height ?? 24

  return {
    entries: Object.keys(collection.icons).map((name) => ({ name, words: spaced(name) })),
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
  return iconify((await import('@iconify-json/flat-color-icons/icons.json')).default)
}

/** A name as the words somebody would search for: `BookOpen` and `book-open` both
 *  read as "book open". */
function spaced(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
}

/** The set the picker opens on, and the one a bare name means. Lucide, because it
 *  is the set the app is drawn in and the one every file already speaks. */
export const DEFAULT_SET = LUCIDE

/** The id of the coloured set, so the credits and the tests can name it. */
export const FLAT_COLOUR = 'flat-color-icons'

/** Every set, in the order the picker shows them: the one the app is drawn in
 *  first, then the pictures. */
export const ICON_SETS: readonly IconSet[] = [
  {
    id: LUCIDE,
    label: key('Line'),
    credit: 'Lucide, ISC',
    load: loadLucide,
  },
  {
    id: EMOJI_SET,
    label: key('Emoji'),
    credit: '',
    load: loadEmoji,
  },
  {
    id: FLAT_COLOUR,
    label: key('Colour'),
    credit: 'Flat Color Icons by Icons8, MIT',
    load: loadFlatColour,
  },
]

export function setNamed(id: string): IconSet | null {
  return ICON_SETS.find((one) => one.id === id) ?? null
}
