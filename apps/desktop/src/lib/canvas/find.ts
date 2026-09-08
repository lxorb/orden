/** Finding something on a plane.
 *
 *  A canvas can hold five hundred cards and no scrollbar to look down, so the
 *  only way to find a word on one is to be taken to it. This says which things
 *  hold the word; the surface frames them one at a time.
 *
 *  Everything a card can say is searched, whichever kind it is: the words of a
 *  text card, the path of a file card, the address of a link, the name on a
 *  frame and the words along a connector. A reader looking for "invoice" does
 *  not care which of those it turned out to be. */

import type { Canvas } from './format'

/** What one hit is: the thing that holds the word, and enough of what it says to
 *  recognise it by. */
export interface Found {
  id: string
  /** A line to show in the list, already trimmed to something readable. */
  says: string
}

/** How much of a card's words a hit shows. Enough to tell two apart. */
const SHOWN = 60

function shortened(text: string, term: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= SHOWN) return flat

  const at = flat.toLowerCase().indexOf(term.toLowerCase())
  if (at < 0) return `${flat.slice(0, SHOWN)}…`

  const from = Math.max(0, at - 20)
  return `${from ? '…' : ''}${flat.slice(from, from + SHOWN)}…`
}

/** Everything on the plane that holds the word, in the order it is drawn in. An
 *  empty term finds nothing rather than everything: a list of the whole canvas
 *  is not an answer to a question nobody asked yet. */
export function matches(canvas: Canvas, term: string): Found[] {
  const wanted = term.trim().toLowerCase()
  if (!wanted) return []

  const found: Found[] = []

  for (const node of canvas.nodes) {
    // An empty one holds nothing, and the term is never empty by here.
    const says = saysOf(node)
    if (says.toLowerCase().includes(wanted)) {
      found.push({ id: node.id, says: shortened(says, wanted) })
    }
  }

  for (const edge of canvas.edges) {
    if (edge.label?.toLowerCase().includes(wanted)) {
      found.push({ id: edge.id, says: shortened(edge.label, wanted) })
    }
  }

  return found
}

function saysOf(node: Canvas['nodes'][number]): string {
  switch (node.type) {
    case 'text':
      return node.text
    case 'file':
      return node.file
    case 'link':
      return node.url
    case 'group':
      return node.label ?? ''
    case 'shape':
      return ''
  }
}
