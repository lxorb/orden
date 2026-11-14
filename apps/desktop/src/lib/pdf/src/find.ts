import { type Piece, placesOf, type Words } from '@orden/scan/search/find'

export function runsOfItems(items: readonly object[]): string[] {
  return items.flatMap((item) => {
    if (!('str' in item) || typeof item.str !== 'string') return []
    const ends = 'hasEOL' in item && item.hasEOL === true && !/\s$/.test(item.str)
    return [ends ? `${item.str}\n` : item.str]
  })
}

export function textOfRuns(runs: readonly string[]): string {
  return runs.join('')
}

export interface Place {
  at: number
  length: number
}

const HYPHENS = new Set(['-', '\u00ad', '\u2010'])
const LETTER = /\p{L}/u

function joined(text: string): { said: string; from: number[] } {
  const from: number[] = []
  let said = ''

  for (let at = 0; at < text.length; at++) {
    const char = text.charAt(at)
    const broken =
      HYPHENS.has(char) &&
      text.charAt(at + 1) === '\n' &&
      LETTER.test(text.charAt(at - 1)) &&
      LETTER.test(text.charAt(at + 2))
    if (broken) {
      at++
      continue
    }

    said += char === '\n' ? ' ' : char
    from.push(at)
  }

  return { said, from }
}

export function placesOnPaper(text: string, query: string): Place[] {
  const { said, from } = joined(text)
  return placesOf(said, query).map((found) => {
    const at = from[found] ?? found
    const end = (from[found + query.length - 1] ?? at) + 1
    return { at, length: end - at }
  })
}

export function wordsOfRuns(runs: readonly string[], divs: readonly HTMLElement[]): Words {
  const words: Words = { text: textOfRuns(runs), pieces: [] }
  let at = 0

  for (const [index, run] of runs.entries()) {
    const node = divs[index]?.firstChild
    if (run && isText(node)) words.pieces.push({ node, at })
    at += run.length
  }

  return words
}

export interface Span {
  node: Text
  from: number
  to: number
}

export function spansOver(pieces: readonly Piece[], at: number, length: number): Span[] {
  const end = at + length
  let low = 0
  let high = pieces.length
  while (low < high) {
    const middle = (low + high) >> 1
    const piece = pieces[middle]
    if (piece && piece.at + piece.node.length <= at) low = middle + 1
    else high = middle
  }

  const out: Span[] = []
  for (let index = low; index < pieces.length; index++) {
    const piece = pieces[index]
    if (!piece || piece.at >= end) break
    const from = Math.max(at - piece.at, 0)
    const to = Math.min(end - piece.at, piece.node.length)
    if (from < to) out.push({ node: piece.node, from, to })
  }
  return out
}

function isText(node: ChildNode | null | undefined): node is Text {
  return node?.nodeType === 3
}
