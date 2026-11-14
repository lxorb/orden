import { fold } from './match'

export interface Piece {
  node: Text
  at: number
}

export interface Words {
  text: string
  pieces: Piece[]
  folded?: string
}

function scan(haystack: string, needle: string): number[] {
  const found: number[] = []
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    found.push(at)
  }

  return found
}

export function placesOf(text: string, query: string): number[] {
  if (!query) return []
  return scan(fold(text), fold(query))
}

export function placesIn(words: Words, query: string): number[] {
  if (!query) return []
  return scan((words.folded ??= fold(words.text)), fold(query))
}

export function locate(
  pieces: readonly Piece[],
  offset: number,
): { piece: Piece; into: number } | null {
  let low = 0
  let high = pieces.length - 1
  let found: Piece | null = null

  while (low <= high) {
    const middle = (low + high) >> 1
    const piece = pieces[middle]
    if (!piece) break

    if (piece.at <= offset) {
      found = piece
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return found ? { piece: found, into: offset - found.at } : null
}
