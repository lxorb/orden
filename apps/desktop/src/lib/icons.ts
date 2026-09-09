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
