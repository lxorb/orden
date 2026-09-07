/** Finding words in a note that is being read.
 *
 *  Ours rather than the browser's, because there is no browser's to reach: a
 *  Tauri webview has no find bar and no way to ask for one, and `window.find`
 *  moves the selection without showing anything or counting anything. The
 *  editor's own find is CodeMirror's and needs a document; a rendered page has
 *  none.
 *
 *  So the page's words are read once into a string with a note of which text node
 *  each part came from, the places are found in that string, and each one is shown
 *  by selecting it - which is the browser's own highlight, needs nothing drawn,
 *  and leaves the match ready to copy. Reading it as one string is what lets a
 *  match run across a tag: `the **word**` is two nodes and one phrase. */

/** Where one text node's words start in the page's words. */
export interface Piece {
  node: Text
  at: number
}

/** The words of a page, and where each node's share of them begins. */
export interface Words {
  text: string
  pieces: Piece[]
}

/** Every place `query` appears in `text`, as offsets into it. Case is ignored, the
 *  way every find field in every editor ignores it. Empty for an empty query,
 *  which is a field nobody has typed in yet rather than a search for nothing. */
export function placesOf(text: string, query: string): number[] {
  if (!query) return []

  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  const found: number[] = []

  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    found.push(at)
  }

  return found
}

/** Which piece an offset falls in, and how far into that piece it is. Null when
 *  the offset is past the end of the words, which nothing should ask for. */
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

/** The words of everything under `root`, in reading order. */
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

/** The match at `offset` as a range in the page, or null when the words have
 *  moved since they were read. */
export function rangeOf(words: Words, offset: number, length: number): Range | null {
  const start = locate(words.pieces, offset)
  const end = locate(words.pieces, offset + length)
  if (!start || !end) return null

  const range = start.piece.node.ownerDocument.createRange()
  range.setStart(start.piece.node, Math.min(start.into, start.piece.node.length))
  range.setEnd(end.piece.node, Math.min(end.into, end.piece.node.length))

  return range
}

/** Paints a set of ranges under one of the registry's names, or takes the name
 *  down when there is nothing to paint.
 *
 *  Painted rather than selected. Selecting a match is the obvious way to show it
 *  and the wrong one: an input holds its caret in the same selection the page
 *  does, so moving it leaves the find field with nowhere to type - the second
 *  letter of a query never arrives. A highlight is the browser's own paint over a
 *  range and touches neither the caret nor what a reader has selected to copy. */
export function paint(name: string, ranges: readonly Range[]): void {
  try {
    if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges))
    else CSS.highlights.delete(name)
  } catch {
    // An engine without a highlight registry. The types say there is always one;
    // not every engine agrees yet, and this is the whole of what such a one
    // loses - the find bar still counts and still scrolls.
  }
}
