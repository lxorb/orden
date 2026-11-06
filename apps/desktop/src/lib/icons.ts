import { ACCENTS } from './accents'
import { fuzzy } from './fuzzy'

export type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][]

let library: Record<string, IconNode> | null = null

export async function loadIcons(): Promise<Record<string, IconNode>> {
  if (library) return library

  const module = (await import('lucide')) as unknown as Record<string, unknown>
  const found: Record<string, IconNode> = {}

  for (const [name, value] of Object.entries(module)) {
    if (Array.isArray(value)) found[name] = value as IconNode
  }

  library = found
  return found
}

export function shapeFor(
  library: Record<string, IconNode>,
  chosen: string | null,
): IconNode | null {
  return chosen ? (library[chosen] ?? null) : null
}

export type WrittenIcon =
  | { kind: 'lucide'; name: string }
  | { kind: 'emoji'; text: string }
  | { kind: 'set'; set: string; name: string }

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator})+$/u

const PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

const LONGEST = 16

const PREFIXED = /^([a-z][a-z\d-]*):(.+)$/

export function readIcon(value: string | null | undefined): WrittenIcon | null {
  const said = (value ?? '').trim()
  if (!said) return null

  if (said.length <= LONGEST && PICTURE.test(said) && EMOJI.test(said)) {
    return { kind: 'emoji', text: said }
  }

  const [, set, name] = PREFIXED.exec(said) ?? []
  if (set && name) {
    return set === LUCIDE ? { kind: 'lucide', name } : { kind: 'set', set, name }
  }

  return { kind: 'lucide', name: said }
}

export const LUCIDE = 'lucide'

export const EMOJI_SET = 'emoji'

export const BRANDS = 'simple-icons'

export const EMOJI_OUTLINE = 'fluent-emoji-high-contrast'

export const SITE_ICONS = 'site'

const TINTED_SETS: ReadonlySet<string> = new Set([EMOJI_OUTLINE])

export function takesTint(icon: WrittenIcon | null): boolean {
  if (!icon) return false
  return icon.kind === 'lucide' || (icon.kind === 'set' && TINTED_SETS.has(icon.set))
}

export function inOneColour(icon: WrittenIcon | null): boolean {
  return takesTint(icon) || (icon?.kind === 'set' && icon.set === BRANDS)
}

export function brandIcon(slug: string): string {
  return writtenIcon(BRANDS, slug)
}

const SITES: Readonly<Record<string, string>> = {
  'code.visualstudio.com': 'visualstudiocode',
  'chat.openai.com': 'openai',
  chatgpt: 'openai',
  obsproject: 'obsstudio',
  youtu: 'youtube',
  twitter: 'x',
  'gemini.google.com': 'googlegemini',
  'drive.google.com': 'googledrive',
  'docs.google.com': 'googledocs',
  'calendar.google.com': 'googlecalendar',
  'mail.google.com': 'gmail',
  'maps.google.com': 'googlemaps',
  'teams.microsoft.com': 'microsoftteams',
}

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ne', 'or'])

export function siteBrand(address: string | null | undefined): string | null {
  if (!address) return null

  let host: string
  try {
    const url = new URL(address)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    host = url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }

  const own = SITES[host]
  if (own) return own

  const labels = host.split('.')
  if (labels.length < 2 || /^\d+$/.test(labels.at(-1) ?? '')) return null

  const at = labels.length >= 3 && SECOND_LEVEL.has(labels.at(-2) ?? '') ? -3 : -2
  const name = labels.at(at) ?? ''

  return SITES[name] ?? (/^[a-z\d]+$/.test(name) ? name : null)
}

export function writtenIcon(set: string, name: string): string {
  if (set === EMOJI_SET) return name
  return set === LUCIDE ? iconValue(name) : `${set}:${name}`
}

export function squash(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
}

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

const PACKS = ['li', 'ri', 'fa', 'bx', 'ib', 'lu', 'si', 'oc', 'gi']

export function keyNamed(library: Record<string, IconNode>, name: string): string | null {
  const names = squashedNames(library)
  const asked = squash(name)
  const whole = names.get(asked)
  if (whole) return whole

  const pack = PACKS.find((one) => asked.startsWith(one) && asked.length > one.length)
  return pack ? (names.get(asked.slice(pack.length)) ?? null) : null
}

export function iconValue(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([A-Za-z])(\d)/g, '$1-$2')
    .toLowerCase()
}

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

export { ICON_COLOUR_KEY, ICON_KEY } from '@orden/scan/note'

export function isIconTint(value: string | null | undefined): boolean {
  const said = (value ?? '').trim().toLowerCase()
  return !!said && ACCENTS.some((accent) => accent.id === said)
}

export function readTint(value: string | null | undefined): string | null {
  const said = (value ?? '').trim().toLowerCase()
  return isIconTint(said) ? said : null
}

export function initial(name: string): string {
  const first = name.trim().codePointAt(0)
  return first === undefined ? '·' : String.fromCodePoint(first).toUpperCase()
}

export function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
}

const SYNONYMS: Record<string, string[]> = {
  work: ['Briefcase', 'Building2', 'Laptop'],
  job: ['Briefcase'],
  office: ['Building2', 'Briefcase'],
  personal: ['User', 'Heart', 'House'],
  home: ['House'],
  house: ['House'],
  note: ['NotebookPen', 'StickyNote', 'FileText'],
  journal: ['NotebookPen', 'BookOpen', 'PenLine'],
  diary: ['NotebookPen', 'BookHeart'],
  writing: ['PenLine', 'Feather', 'PenTool'],
  idea: ['Lightbulb', 'Sparkles'],
  project: ['FolderKanban', 'Hammer', 'Target'],
  task: ['ListChecks', 'SquareCheck'],
  todo: ['ListChecks', 'SquareCheck'],
  study: ['GraduationCap', 'BookOpen', 'Library'],
  school: ['GraduationCap', 'Backpack'],
  uni: ['GraduationCap'],
  university: ['GraduationCap'],
  research: ['Microscope', 'FlaskConical', 'Telescope'],
  science: ['Atom', 'FlaskConical', 'Microscope'],
  math: ['Sigma', 'Calculator', 'Radical'],
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

export interface IconEntry {
  name: string
  words: string
  terms?: string
}

const MEANINGS = new Map(Object.entries(SYNONYMS).map(([word, named]) => [word, named.map(squash)]))

function singular(word: string): string {
  return word.endsWith('s') ? word.slice(0, -1) : word
}

function meant(needle: string): Set<string> {
  const found = new Set<string>()

  for (const asked of [needle, ...needle.split(' ')]) {
    for (const key of [asked, singular(asked)]) {
      for (const name of MEANINGS.get(key) ?? []) found.add(name)
    }
  }

  return found
}

function scored(text: string, needle: string): number {
  if (text === needle) return 100
  if (text.startsWith(`${needle} `)) return 80
  if (text.split(' ').includes(needle)) return 70
  if (text.startsWith(needle)) return 60
  return text.includes(needle) ? 40 : 0
}

const KEYWORD = 0.75

const LOOSE = 20

export function rankIcons(entries: readonly IconEntry[], query: string, limit = 120): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return entries.slice(0, limit).map((one) => one.name)

  const boosted = meant(needle)
  const matches: Match[] = []

  for (const { name, words: label, terms } of entries) {
    let score = Math.max(
      scored(label, needle),
      boosted.size > 0 && boosted.has(squash(name)) ? 90 : 0,
      terms ? scored(terms, needle) * KEYWORD : 0,
    )

    if (!score) {
      const loose = fuzzy(needle, label)
      if (loose !== null) score = LOOSE + Math.min(Math.max(loose, 0), 99) / 100
    }

    if (score) matches.push({ name, score: score - label.length / 100 })
  }

  return matches
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((match) => match.name)
}

export function search(names: string[], query: string, limit = 120): string[] {
  return rankIcons(
    names.map((name) => ({ name, words: words(name) })),
    query,
    limit,
  )
}
