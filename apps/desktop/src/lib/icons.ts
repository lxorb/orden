/** What an icon a person chose is written as, and what a written one means.
 *
 *  Three sets are offered and one format holds all three; `WrittenIcon` below is
 *  where that format is spelled out. Lucide is the one this file also loads, since
 *  it is the set the interface itself is drawn in and the one everything falls
 *  back to; the others are icon-sets.ts, which fetches each only when somebody
 *  opens its tab.
 *
 *  Loaded rather than imported, in every case: Lucide alone is far larger than the
 *  app around it, and the emoji index and the coloured set are larger again. None
 *  of them is in the first chunk and none of them is in the plugin build. */

import { ACCENTS } from './accents'

/** An icon as data: the elements it is drawn from, in order, each with the attributes
 *  it carries. Lucide's own shape, restated here so nothing has to import the library
 *  to hold one - and spelled with the `undefined` the library's attributes allow, so
 *  an icon out of a single-file import and one out of the whole set are one type. */
export type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][]

let library: Record<string, IconNode> | null = null

export async function loadIcons(): Promise<Record<string, IconNode>> {
  if (library) return library

  const module = (await import('lucide')) as unknown as Record<string, unknown>
  const found: Record<string, IconNode> = {}

  for (const [name, value] of Object.entries(module)) {
    // Every icon is an array of [tag, attributes]; the rest of the module is
    // helper functions.
    if (Array.isArray(value)) found[name] = value as IconNode
  }

  library = found
  return found
}

/** The shape a space wears, or null where there is none to draw.
 *
 *  Null covers three cases that look the same to a reader and are not the same
 *  thing: a space that never chose an icon, one whose icon this build's library has
 *  never heard of, and one whose library has not finished loading. The caller draws
 *  the space's initial for all three, because a square with a letter in it is a
 *  space and an empty square is a bug. Emil, on his phone: *"I don't see the icons of
 *  the spaces on the Even Realities plugin right now."* */
export function shapeFor(
  library: Record<string, IconNode>,
  chosen: string | null,
): IconNode | null {
  return chosen ? (library[chosen] ?? null) : null
}

/** What an `icon:` in a note's front matter means - and the same value wherever
 *  else one is kept: a canvas's `nib.icon`, a folder's entry in its space's map, a
 *  space's on this device.
 *
 *  One string, three things it can say, and that is the whole storage format:
 *
 *  - an emoji, written as the character. The platform's own colour font draws it,
 *    so the breadth of the whole Unicode set costs nothing to ship.
 *  - a name on its own, `file-text`, which is Lucide's: the stroked set the
 *    interface is already drawn in, and the one everything falls back to.
 *  - `set:name`, for a set that is not Lucide - `flat-color-icons:calendar`. The
 *    prefix is the set's own id, so a value says which drawing it means without a
 *    registry, and a build that has never heard of the set falls back to the
 *    kind's mark rather than drawing the wrong picture.
 *
 *  Read more widely than written, so a vault keeps what somebody chose elsewhere.
 *  Obsidian's Iconize writes a two-letter pack prefix per icon - `LiFileText` for
 *  Lucide, `FaRocket` for Font Awesome - and an emoji as the character; all of
 *  those arrive as the nearest icon in a set nib ships, or as the emoji itself.
 *
 *  Anything else - a name no set holds, a word somebody typed - falls back to the
 *  mark its kind wears. Which is what the row showed before, so nothing is ever a
 *  blank space where an icon should be. */
export type WrittenIcon =
  | { kind: 'lucide'; name: string }
  | { kind: 'emoji'; text: string }
  | { kind: 'set'; set: string; name: string }

/** An emoji rather than a name: the pictures, the modifiers that follow one, and
 *  a pair of regional indicators, which is what a flag is written as. */
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator})+$/u

/** At least one of it has to be an actual picture: the components alone are
 *  digits and hashes, and `2` is not an icon. */
const PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

/** How long a value may be and still be an emoji. A flag with a skin tone on it
 *  is nowhere near this; a sentence somebody wrote under `icon:` is past it. */
const LONGEST = 16

/** A set's id and an icon's name in it, which is how everything but Lucide and the
 *  emoji is written: one colon, the id in front of it. Lucide has no prefix
 *  because it is what a bare name has always meant and files already say it that
 *  way. */
const PREFIXED = /^([a-z][a-z\d-]*):(.+)$/

/** What an `icon:` says, or null when it says nothing this app can draw. */
export function readIcon(value: string | null | undefined): WrittenIcon | null {
  const said = (value ?? '').trim()
  if (!said) return null

  if (said.length <= LONGEST && PICTURE.test(said) && EMOJI.test(said)) {
    return { kind: 'emoji', text: said }
  }

  const [, set, name] = PREFIXED.exec(said) ?? []
  // `lucide:rocket` is a spelling a person might reasonably write, and it means
  // what `rocket` means rather than a set called lucide that has to be looked up.
  if (set && name) {
    return set === LUCIDE ? { kind: 'lucide', name } : { kind: 'set', set, name }
  }

  return { kind: 'lucide', name: said }
}

/** The id the stroked set goes by, where one is needed: the picker's tab, the
 *  recent list, `lucide:rocket` written by hand. Never written into a file. */
export const LUCIDE = 'lucide'

/** The id the emoji go by in the same places. Not a set of drawings at all - the
 *  platform's font draws them - but the picker offers it as one tab among the
 *  others, and one id per tab is what keeps that honest. */
export const EMOJI_SET = 'emoji'

/** What to write for an icon the picker offers: the emoji as itself, a Lucide icon
 *  as Lucide's own plain name, and anything else as `set:name`.
 *
 *  The one place a value is composed, so what is written and what is read cannot
 *  drift - which for a file is the difference between an icon Obsidian's Iconize
 *  can still show and a word it ignores. */
export function writtenIcon(set: string, name: string): string {
  if (set === EMOJI_SET) return name
  return set === LUCIDE ? iconValue(name) : `${set}:${name}`
}

/** A name as letters and digits alone, which is how two spellings of the same
 *  icon are told to be the same one. */
function squash(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
}

/** Every icon under its squashed name. Built once per library rather than per
 *  row of a file list: a tree of a thousand notes asks this a thousand times. */
let squashed: { of: Record<string, IconNode>; names: Map<string, string> } | null = null

function squashedNames(library: Record<string, IconNode>): Map<string, string> {
  if (squashed?.of === library) return squashed.names

  const names = new Map<string, string>()
  for (const key of Object.keys(library)) {
    if (!names.has(squash(key))) names.set(squash(key), key)
  }

  squashed = { of: library, names }
  return names
}

/** The two-letter prefixes Obsidian's Iconize puts in front of a name, one per
 *  pack: Lucide, Remix, Font Awesome, Boxicons, and the rest of what it offers.
 *
 *  Nib ships one stroked set, so a name out of any of those packs is looked up in
 *  Lucide without its prefix - `FaRocket` finds `rocket`. Which is the right answer
 *  far more often than nothing at all: the packs draw the same everyday things
 *  under the same everyday names, and a row that showed the plain page for a note
 *  somebody had already given a rocket would read as the icon having been lost. */
const PACKS = ['li', 'ri', 'fa', 'bx', 'ib', 'lu', 'si', 'oc', 'gi']

/** Which icon of the library a written name means, whichever way it was written:
 *  `file-text`, `FileText`, `file_text` and Iconize's `LiFileText` all reach the
 *  same one. Null where the library holds nothing by that name.
 *
 *  Letters and digits alone decide, because the two conventions disagree about
 *  where the dashes go and Lucide itself is not consistent about the numbers:
 *  `grid-2x2` and `arrow-up-0-1` are one icon each. A pack's prefix is only
 *  dropped when the whole name found nothing, so `link` and `list` are still
 *  themselves. */
export function keyNamed(library: Record<string, IconNode>, name: string): string | null {
  const names = squashedNames(library)
  const asked = squash(name)
  const whole = names.get(asked)
  if (whole) return whole

  const pack = PACKS.find((one) => asked.startsWith(one) && asked.length > one.length)
  return pack ? (names.get(asked.slice(pack.length)) ?? null) : null
}

/** What a note writes to wear an icon: Lucide's own name for it, `file-text` for
 *  `FileText`.
 *
 *  A handful of the names with digits in them come out with one dash more than
 *  Lucide writes - `grid-2x-2` for `grid-2x2` - because no rule fits both that
 *  and `gamepad-2`. Both read back as the same icon, here and in a vault, since
 *  reading compares letters and digits only. */
export function iconValue(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([A-Za-z])(\d)/g, '$1-$2')
    .toLowerCase()
}

/** Whether two written values name the same icon, however each was spelled.
 *
 *  What the picker asks to show the one already worn as chosen. `FileText`,
 *  `file-text` and Iconize's `LiFileText` are one icon written three ways, and a space
 *  on this machine may still hold the library's own key from before there was a format
 *  to share; comparing letters and digits alone is what makes all of them the same
 *  answer. An emoji and a set's own name are compared as they stand: those are exact. */
export function sameIcon(one: string | null, other: string | null): boolean {
  if (one === other) return true

  const mine = readIcon(one)
  const yours = readIcon(other)
  if (!mine || mine.kind !== yours?.kind) return false

  if (mine.kind === 'lucide' && yours.kind === 'lucide') {
    return squash(mine.name) === squash(yours.name)
  }

  return JSON.stringify(mine) === JSON.stringify(yours)
}

/** The two keys a note keeps this under, and the names the same two things go by in
 *  a canvas's `nib` key and in a space's own store.
 *
 *  Written out here, in the module about icon values, because three readers have to
 *  agree on them: the writer, the scan that reads a whole space, and the Rust twin of
 *  that scan. `icon` is Obsidian's Iconize spelling, which is the point of it; the
 *  colour is hyphenated beside it in the way YAML keys in a note usually are. */
export const ICON_KEY = 'icon'
export const ICON_COLOUR_KEY = 'icon-color'

/** The colours a stroked icon may be drawn in.
 *
 *  The accents the app already offers, by their own ids, so a tinted icon is a
 *  colour the theme knows rather than a hex somebody picked: it has a shade for
 *  black and one for white, it is the colour the rest of the interface uses, and a
 *  file that names one still means something in next year's palette. See
 *  accents.ts, which is where the shades live.
 *
 *  Only for the stroked set. An emoji and a coloured drawing already have their own
 *  colours, and tinting either would be painting over somebody's picture. */
export function isIconTint(value: string | null | undefined): boolean {
  const said = (value ?? '').trim().toLowerCase()
  return !!said && ACCENTS.some((accent) => accent.id === said)
}

/** The tint a value names, or null where it names none this build knows. */
export function readTint(value: string | null | undefined): string | null {
  const said = (value ?? '').trim().toLowerCase()
  return isIconTint(said) ? said : null
}

/** What a space with no shape shows: the first letter of its name, and a dot for a
 *  name that is nothing but spaces. */
export function initial(name: string): string {
  const first = name.trim().codePointAt(0)
  return first === undefined ? '·' : String.fromCodePoint(first).toUpperCase()
}

/** `BookOpen` reads as "book open", which is what people actually search for. */
export function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
}

/** Words people use that are not the icon's own name. Without these, searching
 *  "work" or "money" finds nothing at all. */
const SYNONYMS: Record<string, string[]> = {
  work: ['Briefcase', 'Building2', 'Laptop'],
  job: ['Briefcase'],
  office: ['Building2', 'Briefcase'],
  personal: ['User', 'Heart', 'House'],
  home: ['House'],
  house: ['House'],
  note: ['NotebookPen', 'StickyNote', 'FileText'],
  notes: ['NotebookPen', 'StickyNote', 'FileText'],
  journal: ['NotebookPen', 'BookOpen', 'PenLine'],
  diary: ['NotebookPen', 'BookHeart'],
  writing: ['PenLine', 'Feather', 'PenTool'],
  idea: ['Lightbulb', 'Sparkles'],
  ideas: ['Lightbulb', 'Sparkles'],
  project: ['FolderKanban', 'Hammer', 'Target'],
  projects: ['FolderKanban', 'Hammer'],
  task: ['ListChecks', 'SquareCheck'],
  tasks: ['ListChecks', 'SquareCheck'],
  todo: ['ListChecks', 'SquareCheck'],
  study: ['GraduationCap', 'BookOpen', 'Library'],
  school: ['GraduationCap', 'Backpack'],
  uni: ['GraduationCap'],
  university: ['GraduationCap'],
  research: ['Microscope', 'FlaskConical', 'Telescope'],
  science: ['Atom', 'FlaskConical', 'Microscope'],
  money: ['Wallet', 'PiggyBank', 'Banknote', 'CreditCard'],
  finance: ['ChartLine', 'Wallet', 'Banknote'],
  travel: ['Plane', 'Map', 'Luggage'],
  trip: ['Plane', 'Luggage', 'Map'],
  food: ['Utensils', 'ChefHat', 'Apple'],
  cooking: ['ChefHat', 'CookingPot'],
  recipe: ['ChefHat', 'CookingPot', 'Utensils'],
  health: ['HeartPulse', 'Stethoscope', 'Dumbbell'],
  fitness: ['Dumbbell', 'Bike', 'Footprints'],
  sport: ['Dumbbell', 'Trophy', 'Bike'],
  music: ['Music', 'Headphones', 'Guitar'],
  photo: ['Camera', 'Image'],
  film: ['Clapperboard', 'Film', 'Video'],
  game: ['Gamepad2', 'Dices'],
  games: ['Gamepad2', 'Dices'],
  code: ['Code', 'Terminal', 'Braces'],
  dev: ['Code', 'Terminal', 'Bug'],
  design: ['Palette', 'PenTool', 'Shapes'],
  art: ['Palette', 'Brush'],
  garden: ['Sprout', 'Flower', 'TreePine'],
  plant: ['Sprout', 'Leaf', 'Flower'],
  pet: ['Dog', 'Cat', 'PawPrint'],
  family: ['Users', 'Heart', 'House'],
  meeting: ['Users', 'Calendar', 'Presentation'],
  calendar: ['Calendar', 'CalendarDays'],
  archive: ['Archive', 'Box'],
  private: ['Lock', 'Shield', 'EyeOff'],
  secret: ['Lock', 'KeyRound', 'EyeOff'],
  star: ['Star', 'Sparkles'],
  important: ['Star', 'Flag', 'CircleAlert'],
  reading: ['BookOpen', 'Library', 'Bookmark'],
  book: ['Book', 'BookOpen', 'Library'],
  list: ['List', 'ListChecks'],
  inbox: ['Inbox', 'Mail'],
  draft: ['FilePen', 'PencilLine'],
  blog: ['Rss', 'Newspaper', 'Globe'],
  web: ['Globe', 'Link'],
}

interface Match {
  name: string
  score: number
}

/** One icon somebody can pick: the set's own name for it, and everything it can be
 *  found by.
 *
 *  Two fields because the three sets name things differently. Lucide's key is
 *  `BookOpen`, an emoji's name is "open book" and its own slug says the same words
 *  again, and a flat drawing's name is `folder`. Each set fills `words` from what it
 *  has, so the search field is one search field. */
export interface IconEntry {
  name: string
  /** Lowercase, space-separated. */
  words: string
}

/** Ranks icons for a query. Exact names first, then whole words, then the loose
 *  matches - so "book" leads with `Book`, not `BookmarkMinus`.
 *
 *  Over entries rather than over names, so one search reads every set: what an emoji
 *  is called is not what it is written as, and a set whose names are already words
 *  needs no spelling out. An empty query is the set's own order, which for the emoji
 *  is Unicode's and for the others is the library's. */
export function rankIcons(entries: readonly IconEntry[], query: string, limit = 120): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return entries.slice(0, limit).map((one) => one.name)

  const boosted = new Set(SYNONYMS[needle] ?? [])
  const matches: Match[] = []

  for (const { name, words: label } of entries) {
    let score = 0

    if (label === needle) score = 100
    else if (boosted.has(name)) score = 90
    else if (label.startsWith(`${needle} `)) score = 80
    else if (label.split(' ').includes(needle)) score = 70
    else if (label.startsWith(needle)) score = 60
    else if (label.includes(needle)) score = 40

    // A shorter name matching the same way is the more obvious answer.
    if (score) matches.push({ name, score: score - label.length / 100 })
  }

  return matches
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((match) => match.name)
}

/** The same, for a list of the library's own keys. What the icon suggestions and the
 *  tests speak, since a Lucide key is the only name that is also a word. */
export function search(names: string[], query: string, limit = 120): string[] {
  return rankIcons(
    names.map((name) => ({ name, words: words(name) })),
    query,
    limit,
  )
}
