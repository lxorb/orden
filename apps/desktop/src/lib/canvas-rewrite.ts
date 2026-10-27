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

import type { Canvas } from '@nib/markdown/canvas'
import { type FoundLink, isPagesTarget } from '@nib/markdown/links'
import { paperOf } from './pages/held'
import { folderOf } from './space-paths'
import type { NoteDoc } from './workspace/documents.svelte'
import { skim, type Span } from './json-skim'
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
 *  relative to the space and null for one to leave alone; see `retargetLinks`.
 *
 *  Each card changed is an edit made `now`, and is stamped so in a plane that keeps
 *  times. With the time it had, a plane open and drawn on merged the rewrite with
 *  what it held as two versions of one edit, and kept whichever sorted first: a
 *  card renamed from `Plan.md` to `Road.md` went back to `Plan.md`, on screen and in
 *  the file. See `later` in canvas-merge.ts. A plane with no times, another app's,
 *  is given none here, since writing them in would change a file nobody has opened;
 *  one that is open is rewritten through its surface instead, which stamps what it
 *  changes (`relinked` in canvas/store.svelte.ts). */
export function retargetCanvas(
  text: string,
  /** The canvas, relative to the space, where it is now. */
  source: string,
  file: (path: string) => string | null,
  to: (link: FoundLink) => string | null,
  now = Date.now(),
): string | null {
  const nodes = nodeStrings(text)
  if (!nodes) return null

  const edits: Edit[] = []
  const changed: string[] = []
  for (const node of nodes) {
    const type = node.get('type')?.value
    const card = node.get('file')
    const words = node.get('text')
    const there = type === 'file' && card ? file(card.value) : null
    const id = node.get('id')?.value

    if (card && there !== null) {
      edits.push({ from: card.from, to: card.to, insert: JSON.stringify(there) })
      if (id !== undefined) changed.push(id)
    } else if (type === 'text' && words) {
      const after = retargetLinks(words.value, source, to)
      if (after !== null && after !== words.value) {
        edits.push({ from: words.from, to: words.to, insert: JSON.stringify(after) })
        if (id !== undefined) changed.push(id)
      }
    }
  }
  if (!edits.length) return null
  edits.push(...timesOf(text, changed, now))

  // From the end, so an edit never moves the place of one still to be made.
  let out = text
  for (const edit of edits.sort((one, other) => other.from - one.from)) {
    out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to)
  }
  return out
}

/** The same rewrite of a plane drawn on screen, card by card: every card it leaves
 *  alone is the very card it was, so the edit is stamped as changing only the ones it
 *  changed (`stamped` in canvas-merge.ts). The plane itself where nothing changed. */
export function retargetPlane(
  canvas: Canvas,
  source: string,
  file: (path: string) => string | null,
  to: (link: FoundLink) => string | null,
): Canvas {
  const nodes = canvas.nodes.map((node) => {
    if (node.type === 'file') {
      const there = file(node.file)
      return there === null ? node : { ...node, file: there }
    }
    if (node.type !== 'text') return node
    const after = retargetLinks(node.text, source, to)
    return after === null || after === node.text ? node : { ...node, text: after }
  })
  return nodes.some((node, at) => node !== canvas.nodes[at]) ? { ...canvas, nodes } : canvas
}

/** Where each card of the plane at `note` goes once `moving` is done, or null for a
 *  page note in a folder, whose links are asked the way a note's are. A card is a path
 *  from the top of the space, never resolved by name: asked as a wikilink, `Plan.md`
 *  still reached `Archive/Plan.md`, and the card was left naming nothing. A page note in
 *  a folder reads a page's paper from that folder first, and every page note reads
 *  the paper it holds first by the name it had (`paperPlaces` in pages/held.ts), so a
 *  card naming that paper, or going to be it, is left alone. */
export function cardsMoving(
  note: string,
  moving: (path: string) => string | null,
): ((path: string) => string | null) | null {
  if (!isPagesTarget(note)) return moving
  if (folderOf(note) !== '') return null
  const own = paperOf(note)
  return (path) => {
    const there = path === own ? null : moving(path)
    return there === own ? null : there
  }
}

/** The canvas on screen for an open document, when one is drawn; see `relinked` in
 *  canvas/store.svelte.ts. */
export async function drawnPlane(doc: NoteDoc) {
  const [{ CanvasStore }, { workspace }] = await Promise.all([
    import('./canvas/store.svelte'),
    import('./workspace.svelte'),
  ])
  return CanvasStore.drawing(doc, workspace.tabs)
}

/** One piece of the file replaced. */
interface Edit {
  from: number
  to: number
  insert: string
}

/** The edits that stamp `ids` with `now` in the plane's times, `nib.at`: each time in
 *  place, and one the plane has none for put first. None where it keeps no times. */
function timesOf(text: string, ids: readonly string[], now: number): Edit[] {
  const nib = skim(text, ['nib'])?.get('nib')
  const at: Span | undefined = nib ? skim(text, ['at'], nib)?.get('at') : undefined
  const held = at ? skim(text, ids, at) : null
  if (!at || !held) return []

  const edits: Edit[] = []
  const missing: string[] = []
  for (const id of new Set(ids)) {
    const time = held.get(id)
    if (time) edits.push({ from: time.from, to: time.to, insert: String(now) })
    else missing.push(id)
  }
  if (missing.length) {
    const empty = text.slice(at.from + 1, at.to - 1).trim() === ''
    const added = missing.map((id) => `${JSON.stringify(id)}: ${now}`).join(', ')
    edits.push({ from: at.from + 1, to: at.from + 1, insert: empty ? added : `${added}, ` })
  }
  return edits
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
