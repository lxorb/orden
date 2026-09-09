/** What was said, as something to do.
 *
 *  A grammar rather than a model: the phrases are Emil's list and there are
 *  fourteen of them, so matching is a table and a couple of numbers. That is the
 *  whole reason a command can feel instant - the recognition is the slow part and
 *  this adds nothing measurable to it.
 *
 *  Written to be forgiving in the two ways speech is unreliable. A recogniser puts
 *  punctuation in ("Next."), capitalises the first word, spells a number as a word
 *  ("page four"), and hears a name slightly wrong ("switch note to meeting notes"
 *  for a note called "Meeting Notes 2026"). So everything is folded to bare
 *  lowercase words, numbers are read either way round, and a name is matched by how
 *  much of it was heard rather than by being right.
 *
 *  Nothing here touches the glasses, the workspace or a clock, which is what makes
 *  each phrase in the table a test. */

/** What the reader asked for. */
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
  /** Everything after the word "question", to be asked of a model. */
  | { kind: 'question'; asked: string }

/** The numbers a recogniser writes as words. Up to twenty and then the tens, which
 *  covers every page of a note anybody reads on a pair of glasses; past that it
 *  writes digits anyway. */
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

/** What is left of a heard phrase once the recogniser's own habits are taken off:
 *  bare lowercase words with single spaces between them. */
export function bare(said: string): string {
  return said
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** A number, written either as digits or as the words for them. `null` when the
 *  words are not a number at all, which is how "open page" alone is refused rather
 *  than turned into page zero. */
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
    // "twenty one" is twenty and one; "one hundred" is one times a hundred.
    if (value === 100) total = Math.max(1, total) * 100
    else total += value
  }

  return seen ? total : null
}

/** How well a heard name matches a real one, from zero to one.
 *
 *  Every word of the name that was heard counts, and a name with words nobody said
 *  counts for less: "meeting" against "Meeting Notes 2026" is a good match and
 *  "notes" against it is a worse one, which is the right way round when the reader
 *  has three notes with "notes" in the title.
 *
 *  Words rather than characters on purpose. Edit distance over a whole title makes
 *  "Monday" and "Tuesday" close and "Meeting" and "Meeting Notes" far apart, which
 *  is exactly backwards for names somebody says out loud. */
export function likeness(heard: string, name: string): number {
  const said = bare(heard).split(' ').filter(Boolean)
  const real = bare(name).split(' ').filter(Boolean)
  if (!said.length || !real.length) return 0

  let hit = 0
  const left = [...real]
  for (const word of said) {
    // A word of the name in full, or the start of one: a recogniser drops a plural
    // and a reader does not say a file extension.
    const at = left.findIndex((one) => one === word || one.startsWith(word) || word.startsWith(one))
    if (at < 0) continue

    hit++
    left.splice(at, 1)
  }

  if (!hit) return 0
  // How much of what was said landed, and how much of the name was covered. The
  // first matters more: the reader chose their words and left the rest out.
  return (hit / said.length) * 0.7 + (hit / real.length) * 0.3
}

/** How close a name has to be before it is taken as the one meant.
 *
 *  A quarter: one word of a four word title, said correctly, is enough, and a
 *  sentence that happens to share one common word with a note is not. */
const CLOSE = 0.25

/** The best match among some names, or null when nothing was close enough. */
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

/** The phrases, longest first, so that "voice commands off" is not read as
 *  "voice commands on" with a stray word after it. */
const PHRASES: readonly { words: string[]; of: (rest: string) => Command | null }[] = [
  { words: ['voice', 'commands', 'on'], of: () => ({ kind: 'voice', on: true }) },
  { words: ['voice', 'commands', 'off'], of: () => ({ kind: 'voice', on: false }) },
  { words: ['voice', 'on'], of: () => ({ kind: 'voice', on: true }) },
  { words: ['voice', 'off'], of: () => ({ kind: 'voice', on: false }) },
  { words: ['switch', 'space', 'to'], of: (rest) => named('switchSpace', rest) },
  { words: ['switch', 'note', 'to'], of: (rest) => named('switchNote', rest) },
  { words: ['switch', 'space'], of: () => ({ kind: 'spaces' }) },
  { words: ['switch', 'note'], of: () => ({ kind: 'notes' }) },
  { words: ['spaces', 'view'], of: () => ({ kind: 'spaces' }) },
  { words: ['notes', 'view'], of: () => ({ kind: 'notes' }) },
  { words: ['open', 'page'], of: (rest) => counted('page', rest) },
  { words: ['go', 'to', 'line'], of: (rest) => counted('line', rest) },
  { words: ['go', 'to', 'page'], of: (rest) => counted('page', rest) },
  { words: ['question'], of: (rest) => (rest ? { kind: 'question', asked: rest } : null) },
  { words: ['next'], of: () => ({ kind: 'next' }) },
  { words: ['back'], of: () => ({ kind: 'back' }) },
  { words: ['close'], of: () => ({ kind: 'close' }) },
]

/** A switch to a name, or the picker when the name did not arrive.
 *
 *  A recogniser cuts an utterance off at a pause, so "switch note to..." with the
 *  name lost is a thing that happens. Putting the picker up is what the reader
 *  wanted one gesture ago; doing nothing at all is the one answer that is no use. */
function named(kind: 'switchSpace' | 'switchNote', rest: string): Command {
  if (rest) return { kind, name: rest }
  return kind === 'switchSpace' ? { kind: 'spaces' } : { kind: 'notes' }
}

function counted(kind: 'page' | 'line', rest: string): Command | null {
  const number = numberIn(rest)
  return number !== null && number > 0 ? { kind, number } : null
}

/** What was said, as a command, or null when it was not one of them.
 *
 *  A phrase has to start what was heard, because a recogniser hands over whole
 *  utterances and "the next thing to do" is not a page turn. The one exception is
 *  "question", which takes everything after it whatever that is. */
export function commandIn(said: string): Command | null {
  const words = bare(said).split(' ').filter(Boolean)
  if (!words.length) return null

  for (const phrase of PHRASES) {
    if (phrase.words.length > words.length) continue
    if (!phrase.words.every((word, at) => words[at] === word)) continue

    return phrase.of(words.slice(phrase.words.length).join(' '))
  }

  return null
}
