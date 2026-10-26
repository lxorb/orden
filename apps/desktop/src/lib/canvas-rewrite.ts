/** Rewriting the links on a canvas to a note that has just been renamed or moved.
 *
 *  A canvas is JSON, so it is rewritten as JSON rather than as text: a file card
 *  names its note by path in `file`, which no link reader finds, and a text card's
 *  words sit inside a JSON string, where a new name with a quote in it ended the
 *  string early and left a plane that no longer opens. Each card's `file` and `text`
 *  are read as the JSON strings they are, its words rewritten the way a note's are
 *  (link-rewrite.ts), and only those strings written back, in place.
 *
 *  In place, and not the plane read and written again: the canvas may be another
 *  app's, with nodes, edges and keys this build does not read, numbers it would round
 *  and an order of keys of its own, and a rename reaches every canvas that links the
 *  note, opened or not. Read and written back, all of that went (#501, B416); edited
 *  in place, every character but the changed paths is the one that was there.
 *
 *  Its own module, fetched by the rewrite that needs it. */

import type { FoundLink } from '@nib/markdown/links'
import { type Move, retargetLinks } from './link-rewrite'

/** The plane with every card that points at `move.from` pointing at `move.to`, or
 *  null where none does, or where the text is not a plane to write over. */
export function rewriteCanvasLinks(
  text: string,
  /** The canvas, relative to the space. */
  source: string,
  move: Move,
  points: (link: FoundLink) => boolean,
): string | null {
  return retargetCanvas(
    text,
    source,
    (file) => (file === move.from ? move.to : null),
    (link) => (points(link) ? move.to : null),
  )
}

/** The same with a place of its own for each card and link: `file` answers where
 *  the file a card names is now, and `to` where a text card's link points now, each
 *  relative to the space and null for one to leave alone; see `retargetLinks`. */
export function retargetCanvas(
  text: string,
  /** The canvas, relative to the space, where it is now. */
  source: string,
  file: (path: string) => string | null,
  to: (link: FoundLink) => string | null,
): string | null {
  const nodes = nodeStrings(text)
  if (!nodes) return null

  const edits: { from: number; to: number; insert: string }[] = []
  for (const node of nodes) {
    const type = node.get('type')?.value
    const card = node.get('file')
    const words = node.get('text')
    const there = type === 'file' && card ? file(card.value) : null

    if (card && there !== null) {
      edits.push({ from: card.from, to: card.to, insert: JSON.stringify(there) })
    } else if (type === 'text' && words) {
      const after = retargetLinks(words.value, source, to)
      if (after !== null && after !== words.value) {
        edits.push({ from: words.from, to: words.to, insert: JSON.stringify(after) })
      }
    }
  }
  if (!edits.length) return null

  // From the end, so an edit never moves the place of one still to be made.
  let out = text
  for (const edit of edits.sort((one, other) => other.from - one.from)) {
    out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to)
  }
  return out
}

/** A string value in the file: where its literal starts and ends, and what it says. */
interface Spot {
  from: number
  to: number
  value: string
}

/** The string-valued keys of each object in the plane's `nodes`, by key, with where
 *  each literal sits in the text. Null for a file that is not a JSON object. A walk of
 *  the JSON rather than a parse, because a parse says what the file means and not where
 *  in it each thing is written; anything that is not a string is stepped over whole. */
function nodeStrings(text: string): Map<string, Spot>[] | null {
  const nodes: Map<string, Spot>[] = []
  let at = 0

  const fail = (): never => {
    throw new SyntaxError('not JSON')
  }
  const space = () => {
    while (at < text.length && /\s/.test(text[at] ?? '')) at++
  }
  const literal = (): Spot => {
    const from = at
    if (text[at] !== '"') fail()
    at++
    while (at < text.length && text[at] !== '"') at += text[at] === '\\' ? 2 : 1
    if (at >= text.length) fail()
    at++
    return { from, to: at, value: JSON.parse(text.slice(from, at)) as string }
  }
  const object = (entry: (key: string) => void) => {
    at++
    space()
    if (text[at] === '}') {
      at++
      return
    }
    for (;;) {
      space()
      const key = literal().value
      space()
      if (text[at] !== ':') fail()
      at++
      space()
      entry(key)
      space()
      if (text[at] === ',') at++
      else if (text[at] === '}') {
        at++
        return
      } else fail()
    }
  }
  const array = (item: () => void) => {
    at++
    space()
    if (text[at] === ']') {
      at++
      return
    }
    for (;;) {
      space()
      item()
      space()
      if (text[at] === ',') at++
      else if (text[at] === ']') {
        at++
        return
      } else fail()
    }
  }
  const value = (): void => {
    const first = text[at]
    if (first === '{') object(() => value())
    else if (first === '[') array(() => value())
    else if (first === '"') literal()
    else {
      const match = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(at))
      if (!match) fail()
      at += match?.[0].length ?? 0
    }
  }
  const node = () => {
    if (text[at] !== '{') {
      value()
      return
    }
    const strings = new Map<string, Spot>()
    object((key) => {
      if (text[at] === '"') strings.set(key, literal())
      else value()
    })
    nodes.push(strings)
  }

  try {
    space()
    if (text[at] !== '{') return null
    object((key) => {
      if (key === 'nodes' && text[at] === '[') array(node)
      else value()
    })
    space()
    return at === text.length ? nodes : null
  } catch {
    return null
  }
}
