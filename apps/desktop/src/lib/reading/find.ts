import { fold } from '@orden/scan/search/match'

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

export function wordsOf(root: HTMLElement): Words {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const pieces: Piece[] = []
  const parts: string[] = []
  let at = 0

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? ''
    if (!text) continue

    pieces.push({ node: node as Text, at })
    parts.push(text)
    at += text.length
  }

  return { text: parts.join(''), pieces }
}

export function rangeOf(words: Words, offset: number, length: number): Range | null {
  const start = locate(words.pieces, offset)
  const end = locate(words.pieces, offset + length)
  if (!start || !end) return null

  const range = start.piece.node.ownerDocument.createRange()
  range.setStart(start.piece.node, Math.min(start.into, start.piece.node.length))
  range.setEnd(end.piece.node, Math.min(end.into, end.piece.node.length))

  return range
}

const painted = new Map<string, Map<object, readonly Range[]>>()

export function paint(owner: object, name: string, ranges: readonly Range[]): void {
  const owners = painted.get(name) ?? new Map<object, readonly Range[]>()
  if (ranges.length) owners.set(owner, ranges)
  else owners.delete(owner)
  if (owners.size) painted.set(name, owners)
  else painted.delete(name)

  const all = [...owners.values()].flat()
  try {
    if (all.length) CSS.highlights.set(name, new Highlight(...all))
    else CSS.highlights.delete(name)
  } catch {
    // An engine without a highlight registry. The types say there is always one;
    // not every engine agrees yet, and this is the whole of what such a one
    // loses - the find bar still counts and still scrolls.
  }
}
