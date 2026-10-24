/** Rewriting the links on a canvas to a note that has just been renamed or moved.
 *
 *  A canvas is JSON, so it is rewritten as JSON rather than as text: a file card
 *  names its note by path in `file`, which no link reader finds, and a text card's
 *  words sit inside a JSON string, where a new name with a quote in it ended the
 *  string early and left a plane that no longer opens. Each card is read, its own
 *  words rewritten the way a note's are (link-rewrite.ts), and the plane written
 *  back the way the canvas writer writes every plane.
 *
 *  Its own module, fetched by the rewrite that needs it: the reader and writer are
 *  the whole of JSON Canvas, and a rename of a note on its own needs neither. */

import { canvasIn, writeCanvas } from '@nib/markdown/canvas'
import type { FoundLink } from '@nib/markdown/links'
import { type Move, rewriteLinks } from './link-rewrite'

/** The plane with every card that points at `move.from` pointing at `move.to`, or
 *  null where none does, or where the text is not a plane to write over. */
export function rewriteCanvasLinks(
  text: string,
  /** The canvas, relative to the space. */
  source: string,
  move: Move,
  points: (link: FoundLink) => boolean,
): string | null {
  const canvas = canvasIn(text)
  if (!canvas) return null

  const nodes = canvas.nodes.map((node) => {
    if (node.type === 'file' && node.file === move.from) return { ...node, file: move.to }
    if (node.type !== 'text') return node

    const words = rewriteLinks(node.text, source, move, points)
    return words === null || words === node.text ? node : { ...node, text: words }
  })

  // A card that changed is a new object; a plane whose cards are all the ones it had
  // is not written at all.
  const changed = nodes.some((node, at) => node !== canvas.nodes[at])
  return changed ? writeCanvas({ ...canvas, nodes }) : null
}
