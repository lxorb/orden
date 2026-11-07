export type Random = (n: number) => number

export interface RandomRule {
  length: number
  upper: boolean
  digits: boolean
  symbols: boolean
}

export const SEPARATORS = [
  'hyphen',
  'space',
  'period',
  'comma',
  'underscore',
  'digit',
  'digitOrSymbol',
] as const

export type Separator = (typeof SEPARATORS)[number]

export interface MemorableRule {
  words: number
  separator: Separator
  capitalize: boolean
  numbers: boolean
}

export interface WordsRule {
  words: number
  separator: Separator | 'none'
  capitalize: boolean
  numbers: boolean
}

export const DEFAULT_RANDOM: RandomRule = { length: 20, upper: true, digits: true, symbols: true }
export const DEFAULT_MEMORABLE: MemorableRule = {
  words: 5,
  separator: 'hyphen',
  capitalize: true,
  numbers: true,
}

export const RANDOM_LENGTH = { min: 4, max: 64 } as const
export const MEMORABLE_WORDS = { min: 1, max: 10 } as const

export const LOWER = 'abcdefghjkmnpqrstuvwxyz'
export const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ'
export const DIGITS = '23456789'
export const SYMBOLS = '!#$%&*+-=?@^_'

const FIXED: Record<Exclude<Separator, 'digit' | 'digitOrSymbol'>, string> = {
  hyphen: '-',
  space: ' ',
  period: '.',
  comma: ',',
  underscore: '_',
}

const RANGE = 2 ** 32

export function secureRandom(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > RANGE) throw new Error('pass: random range')
  const limit = RANGE - (RANGE % n)
  const one = new Uint32Array(1)
  for (;;) {
    globalThis.crypto.getRandomValues(one)
    const value = one[0] ?? 0
    if (value < limit) return value % n
  }
}

function clamped(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, Math.floor(value)))
}

function pick(pool: string, random: Random): string {
  return pool[random(pool.length)] ?? ''
}

function shuffled<T>(items: T[], random: Random): T[] {
  const all = items.slice()
  for (let at = all.length - 1; at > 0; at--) {
    const other = random(at + 1)
    const here = all[at] as T
    all[at] = all[other] as T
    all[other] = here
  }
  return all
}

export function randomPassword(rule: RandomRule, random: Random = secureRandom): string {
  const classes = [
    LOWER,
    ...(rule.upper ? [UPPER] : []),
    ...(rule.digits ? [DIGITS] : []),
    ...(rule.symbols ? [SYMBOLS] : []),
  ]
  const pool = classes.join('')
  const length = clamped(rule.length, RANDOM_LENGTH)
  const chosen = classes.map((one) => pick(one, random))
  while (chosen.length < length) chosen.push(pick(pool, random))
  return shuffled(chosen, random).join('')
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export function chosenWords(
  rule: WordsRule,
  words: readonly string[],
  random: Random = secureRandom,
): string[] {
  const count = clamped(rule.words, MEMORABLE_WORDS)
  const chosen = Array.from({ length: count }, () => words[random(words.length)] ?? '')
  const shaped = rule.capitalize ? chosen.map(capitalized) : chosen
  if (!rule.numbers) return shaped
  const numbered = random(count)
  return shaped.map((word, at) => (at === numbered ? word + pick(DIGITS, random) : word))
}

function separatorOf(separator: Separator | 'none', random: Random): string {
  switch (separator) {
    case 'none':
      return ''
    case 'digit':
      return pick(DIGITS, random)
    case 'digitOrSymbol':
      return pick(DIGITS + SYMBOLS, random)
    case 'hyphen':
    case 'space':
    case 'period':
    case 'comma':
    case 'underscore':
      return FIXED[separator]
  }
}

export function joinedWords(
  chosen: readonly string[],
  separator: Separator | 'none',
  random: Random = secureRandom,
): string {
  return chosen.reduce(
    (text, word, at) => (at === 0 ? word : text + separatorOf(separator, random) + word),
    '',
  )
}

export function memorablePassword(
  rule: MemorableRule,
  words: readonly string[],
  random: Random = secureRandom,
): string {
  return joinedWords(chosenWords(rule, words, random), rule.separator, random)
}
