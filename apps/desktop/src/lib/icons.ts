/** The icon library a space picks from. Lucide: one consistent 24×24 stroke
 *  set, drawn the same way as the icons already in the interface. Loaded only
 *  when the picker opens, since it is far larger than the app around it. */

export type IconNode = [tag: string, attrs: Record<string, string | number>][]

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

/** What an `icon:` in a note's front matter means: one of Lucide's, or an emoji
 *  written in its place.
 *
 *  Two conventions are read and one is written. Nib writes Lucide's own plain
 *  name, `file-text`, because that is what the library calls the icon and what
 *  anybody reading the file can look up. Obsidian's Iconize plugin writes
 *  `LiFileText`, a prefix per icon pack, and an emoji as the character itself, so
 *  a vault arriving from there keeps the icons somebody already chose there.
 *
 *  Anything else - an icon from a pack this app has never heard of, a word
 *  somebody typed - is a name the library does not hold, and the row falls back
 *  to the mark its kind wears. Which is what it showed before, so nothing is
 *  ever a blank space where an icon should be. */
export type WrittenIcon = { kind: 'lucide'; name: string } | { kind: 'emoji'; text: string }

/** An emoji rather than a name: the pictures, the modifiers that follow one, and
 *  a pair of regional indicators, which is what a flag is written as. */
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator})+$/u

/** At least one of it has to be an actual picture: the components alone are
 *  digits and hashes, and `2` is not an icon. */
const PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

/** How long a value may be and still be an emoji. A flag with a skin tone on it
 *  is nowhere near this; a sentence somebody wrote under `icon:` is past it. */
const LONGEST = 16

/** What a note's `icon:` says, or null when it says nothing this app can draw. */
export function readIcon(value: string | null | undefined): WrittenIcon | null {
  const said = (value ?? '').trim()
  if (!said) return null

  if (said.length <= LONGEST && PICTURE.test(said) && EMOJI.test(said)) {
    return { kind: 'emoji', text: said }
  }

  return { kind: 'lucide', name: said }
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

/** Which icon of the library a written name means, whichever way it was written:
 *  `file-text`, `FileText`, `file_text` and Iconize's `LiFileText` all reach the
 *  same one. Null where the library holds nothing by that name.
 *
 *  Letters and digits alone decide, because the two conventions disagree about
 *  where the dashes go and Lucide itself is not consistent about the numbers:
 *  `grid-2x2` and `arrow-up-0-1` are one icon each. The `li` in front of an
 *  Iconize name is only dropped when the whole name found nothing, so `link` and
 *  `list` are still themselves. */
export function keyNamed(library: Record<string, IconNode>, name: string): string | null {
  const names = squashedNames(library)
  const asked = squash(name)

  return names.get(asked) ?? (asked.startsWith('li') ? (names.get(asked.slice(2)) ?? null) : null)
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

/** Ranks icons for a query. Exact names first, then whole words, then the
 *  loose matches - so "book" leads with `Book`, not `BookmarkMinus`. */
export function search(names: string[], query: string, limit = 120): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return names.slice(0, limit)

  const boosted = new Set(SYNONYMS[needle] ?? [])
  const matches: Match[] = []

  for (const name of names) {
    const label = words(name)
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
