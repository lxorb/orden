import { key } from '../i18n.svelte'

export type Command =
  | { kind: 'next' }
  | { kind: 'back' }
  | { kind: 'close' }
  | { kind: 'spaces' }
  | { kind: 'notes' }
  | { kind: 'switchSpace'; name: string }
  | { kind: 'switchNote'; name: string }
  | { kind: 'page'; number: number }
  | { kind: 'line'; number: number }
  | { kind: 'voice'; on: boolean }
  | { kind: 'question'; asked: string }
  | { kind: 'task'; said: string }

const NUMBERS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
}

export function bare(said: string): string {
  return said
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function numberIn(said: string): number | null {
  const words = bare(said).split(' ').filter(Boolean)
  if (!words.length) return null

  const digits = words.join('')
  if (/^\d+$/.test(digits)) return Number(digits)

  let total = 0
  let seen = false
  for (const word of words) {
    const value = NUMBERS[word]
    if (value === undefined) return null

    seen = true
    if (value === 100) total = Math.max(1, total) * 100
    else total += value
  }

  return seen ? total : null
}

export function likeness(heard: string, name: string): number {
  const said = bare(heard).split(' ').filter(Boolean)
  const real = bare(name).split(' ').filter(Boolean)
  if (!said.length || !real.length) return 0

  let hit = 0
  const left = [...real]
  for (const word of said) {
    const at = left.findIndex((one) => one === word || one.startsWith(word) || word.startsWith(one))
    if (at < 0) continue

    hit++
    left.splice(at, 1)
  }

  if (!hit) return 0
  return (hit / said.length) * 0.7 + (hit / real.length) * 0.3
}

const CLOSE = 0.25

export function bestOf(heard: string, names: readonly string[]): string | null {
  let best: string | null = null
  let score = CLOSE

  for (const name of names) {
    const how = likeness(heard, name)
    if (how > score) {
      score = how
      best = name
    }
  }

  return best
}

interface Phrase {
  id: string
  words: string[]
  of: (rest: string) => Command | null
  label?: string
  takes?: true
}

const PHRASES: readonly Phrase[] = [
  {
    id: 'voice-on',
    words: ['voice', 'commands', 'on'],
    of: () => ({ kind: 'voice', on: true }),
    label: key('Turn the microphone on'),
  },
  {
    id: 'voice-off',
    words: ['voice', 'commands', 'off'],
    of: () => ({ kind: 'voice', on: false }),
    label: key('Turn the microphone off'),
  },
  { id: 'voice-on-short', words: ['voice', 'on'], of: () => ({ kind: 'voice', on: true }) },
  { id: 'voice-off-short', words: ['voice', 'off'], of: () => ({ kind: 'voice', on: false }) },
  {
    id: 'switch-space-to',
    takes: true,
    words: ['switch', 'space', 'to'],
    of: (rest) => named('switchSpace', rest),
    label: key('Go to a space by name'),
  },
  {
    id: 'switch-note-to',
    takes: true,
    words: ['switch', 'note', 'to'],
    of: (rest) => named('switchNote', rest),
    label: key('Go to a note by name'),
  },
  {
    id: 'spaces',
    words: ['switch', 'space'],
    of: () => ({ kind: 'spaces' }),
    label: key('Open the spaces'),
  },
  {
    id: 'notes',
    words: ['switch', 'note'],
    of: () => ({ kind: 'notes' }),
    label: key('Open the notes'),
  },
  { id: 'spaces-view', words: ['spaces', 'view'], of: () => ({ kind: 'spaces' }) },
  { id: 'notes-view', words: ['notes', 'view'], of: () => ({ kind: 'notes' }) },
  {
    id: 'page',
    takes: true,
    words: ['open', 'page'],
    of: (rest) => counted('page', rest),
    label: key('Go to a page'),
  },
  {
    id: 'line',
    takes: true,
    words: ['go', 'to', 'line'],
    of: (rest) => counted('line', rest),
    label: key('Go to a line'),
  },
  {
    id: 'page-alias',
    takes: true,
    words: ['go', 'to', 'page'],
    of: (rest) => counted('page', rest),
  },
  {
    id: 'question',
    takes: true,
    words: ['question'],
    of: (rest) => (rest ? { kind: 'question', asked: rest } : null),
    label: key('Ask a question'),
  },
  {
    id: 'task',
    takes: true,
    words: ['task'],
    of: (rest) => (rest ? { kind: 'task', said: rest } : null),
    label: key('Add a task'),
  },
  {
    id: 'task-de',
    takes: true,
    words: ['aufgabe'],
    of: (rest) => (rest ? { kind: 'task', said: rest } : null),
  },
  { id: 'next', words: ['next'], of: () => ({ kind: 'next' }), label: key('Next page') },
  { id: 'back', words: ['back'], of: () => ({ kind: 'back' }), label: key('Previous page') },
  {
    id: 'close',
    words: ['close'],
    of: () => ({ kind: 'close' }),
    label: key('Close what is open'),
  },
]

export const DEFAULT_WORDS: Readonly<Record<string, string>> = Object.fromEntries(
  PHRASES.map((one) => [one.id, one.words.join(' ')]),
)

export function commandWords(): { id: string; label: string; said: string }[] {
  return PHRASES.filter((one) => one.label !== undefined).map((one) => ({
    id: one.id,
    label: one.label ?? '',
    said: one.words.join(' '),
  }))
}

function named(kind: 'switchSpace' | 'switchNote', rest: string): Command {
  if (rest) return { kind, name: rest }
  return kind === 'switchSpace' ? { kind: 'spaces' } : { kind: 'notes' }
}

function counted(kind: 'page' | 'line', rest: string): Command | null {
  const number = numberIn(rest)
  return number !== null && number > 0 ? { kind, number } : null
}

function phrasesFor(words: Readonly<Record<string, string>>) {
  return PHRASES.map((one) => ({
    of: one.of,
    takes: one.takes === true,
    words: bare(words[one.id] ?? one.words.join(' '))
      .split(' ')
      .filter(Boolean),
  }))
    .filter((one) => one.words.length > 0)
    .sort((a, b) => b.words.length - a.words.length)
}

export function settled(said: string, words: Readonly<Record<string, string>> = {}): boolean {
  const heard = bare(said).split(' ').filter(Boolean)
  if (!heard.length) return false

  const phrases = phrasesFor(words)
  const said_ = (one: { words: string[] }) =>
    one.words.length === heard.length && one.words.every((word, at) => heard[at] === word)

  const exact = phrases.find(said_)
  if (!exact || exact.takes) return false

  return !phrases.some(
    (one) => one.words.length > heard.length && heard.every((word, at) => one.words[at] === word),
  )
}

export function commandIn(
  said: string,
  words: Readonly<Record<string, string>> = {},
): Command | null {
  const heard = bare(said).split(' ').filter(Boolean)
  if (!heard.length) return null

  for (const phrase of phrasesFor(words)) {
    if (phrase.words.length > heard.length) continue
    if (!phrase.words.every((word, at) => heard[at] === word)) continue

    return phrase.of(heard.slice(phrase.words.length).join(' '))
  }

  return null
}
