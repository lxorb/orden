import { foldName } from '@orden/markdown/links'
import { walked } from '../../ui-kit/src/api'

const startsWord = (haystack: string, at: number) =>
  at === 0 || /[\s/\\_.-]/.test(haystack.charAt(at - 1))

function bestStart(needle: string, haystack: string): { score: number; first: number } | null {
  const head = needle.charAt(0)
  let best: { score: number; first: number } | null = null
  let tries = 0

  for (let at = haystack.indexOf(head); at >= 0 && tries < 6; at = haystack.indexOf(head, at + 1)) {
    if (best && !startsWord(haystack, at)) continue

    tries++
    const score = walked(needle, haystack, at)
    if (score === null && !best) return null
    if (score !== null && (!best || score > best.score)) best = { score, first: at }
  }

  return best
}

export function fuzzyFolded(needle: string, haystack: string): number | null {
  if (!needle) return 0

  const best = bestStart(needle, haystack)
  return best === null ? null : best.score - Math.floor(haystack.length / 12)
}

export function fuzzyPlaces(query: string, text: string): number[] | null {
  const needle = foldName(query)
  const haystack = foldName(text)
  if (!needle || haystack.length !== text.length) return null

  const best = bestStart(needle, haystack)
  if (!best) return null

  const at: number[] = []
  walked(needle, haystack, best.first, at)
  return at
}

export function oneSlip(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false

  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (i === a.length && i === b.length) return true

  const rest = (x: string, from: number) => x.slice(from)
  return (
    rest(a, i + 1) === rest(b, i + 1) ||
    rest(a, i + 1) === rest(b, i) ||
    rest(a, i) === rest(b, i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && rest(a, i + 2) === rest(b, i + 2))
  )
}

export function nearly(word: string, haystack: string): boolean {
  if (word.length < 5) return false

  for (let at = 0; at < haystack.length; at++) {
    if (!startsWord(haystack, at)) continue

    for (const length of [word.length, word.length - 1, word.length + 1]) {
      if (oneSlip(word, haystack.slice(at, at + length))) return true
    }
  }

  return false
}
