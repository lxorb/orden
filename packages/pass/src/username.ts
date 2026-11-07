import type { Random, WordsRule } from './generate'
import { chosenWords, joinedWords, secureRandom } from './generate'

export interface UsernameRule extends WordsRule {
  leet: boolean
}

export const DEFAULT_USERNAME: UsernameRule = {
  words: 2,
  separator: 'none',
  capitalize: true,
  numbers: true,
  leet: false,
}

const LEET: Record<string, string> = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' }

function leetOf(text: string): string {
  return text.replace(/[aeiost]/gi, (letter) => LEET[letter.toLowerCase()] ?? letter)
}

export function username(
  rule: UsernameRule,
  words: readonly string[],
  random: Random = secureRandom,
): string {
  const plain = words.filter((one) => /^[a-z]+$/i.test(one))
  const joined = joinedWords(chosenWords(rule, plain, random), rule.separator, random)
  return rule.leet ? leetOf(joined) : joined
}
