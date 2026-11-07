import type { MemorableRule, RandomRule, Separator } from '@orden/pass/generate'
import {
  DEFAULT_MEMORABLE,
  DEFAULT_RANDOM,
  MEMORABLE_WORDS,
  memorablePassword,
  RANDOM_LENGTH,
  randomPassword,
  SEPARATORS,
} from '@orden/pass/generate'
import type { UsernameRule } from '@orden/pass/username'
import { DEFAULT_USERNAME, username } from '@orden/pass/username'
import { WORDS } from '@orden/pass/words'
import { isRecord, keepJson, stored } from '../stored'

export const MODES = ['random', 'memorable', 'username'] as const
export type GeneratorMode = (typeof MODES)[number]

export interface GeneratorPrefs {
  mode: GeneratorMode
  random: RandomRule
  memorable: MemorableRule
  username: UsernameRule
}

const KEY = 'nib:pass-generator'

const DEFAULT_PREFS: GeneratorPrefs = {
  mode: 'random',
  random: DEFAULT_RANDOM,
  memorable: DEFAULT_MEMORABLE,
  username: DEFAULT_USERNAME,
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function count(value: unknown, range: { min: number; max: number }, fallback: number): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= range.min &&
    value <= range.max
    ? value
    : fallback
}

function separatorIn<T extends Separator | 'none'>(value: unknown, fallback: T): Separator | T {
  return SEPARATORS.find((one) => one === value) ?? fallback
}

function randomIn(value: unknown): RandomRule {
  const raw = isRecord(value) ? value : {}
  return {
    length: count(raw.length, RANDOM_LENGTH, DEFAULT_RANDOM.length),
    upper: flag(raw.upper, DEFAULT_RANDOM.upper),
    digits: flag(raw.digits, DEFAULT_RANDOM.digits),
    symbols: flag(raw.symbols, DEFAULT_RANDOM.symbols),
  }
}

function memorableIn(value: unknown): MemorableRule {
  const raw = isRecord(value) ? value : {}
  return {
    words: count(raw.words, MEMORABLE_WORDS, DEFAULT_MEMORABLE.words),
    separator: separatorIn(raw.separator, DEFAULT_MEMORABLE.separator),
    capitalize: flag(raw.capitalize, DEFAULT_MEMORABLE.capitalize),
    numbers: flag(raw.numbers, DEFAULT_MEMORABLE.numbers),
  }
}

function usernameIn(value: unknown): UsernameRule {
  const raw = isRecord(value) ? value : {}
  return {
    words: count(raw.words, MEMORABLE_WORDS, DEFAULT_USERNAME.words),
    separator:
      raw.separator === 'none' ? 'none' : separatorIn(raw.separator, DEFAULT_USERNAME.separator),
    capitalize: flag(raw.capitalize, DEFAULT_USERNAME.capitalize),
    numbers: flag(raw.numbers, DEFAULT_USERNAME.numbers),
    leet: flag(raw.leet, DEFAULT_USERNAME.leet),
  }
}

function prefsIn(value: unknown): GeneratorPrefs {
  const raw = isRecord(value) ? value : {}
  return {
    mode: MODES.find((one) => one === raw.mode) ?? DEFAULT_PREFS.mode,
    random: randomIn(raw.random),
    memorable: memorableIn(raw.memorable),
    username: usernameIn(raw.username),
  }
}

export function readPrefs(): GeneratorPrefs {
  return prefsIn(stored(KEY))
}

export function keepPrefs(prefs: GeneratorPrefs): void {
  keepJson(KEY, prefs)
}

export function generated(prefs: GeneratorPrefs): string {
  switch (prefs.mode) {
    case 'random':
      return randomPassword(prefs.random)
    case 'memorable':
      return memorablePassword(prefs.memorable, WORDS)
    case 'username':
      return username(prefs.username, WORDS)
  }
}
