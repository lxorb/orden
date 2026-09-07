/** What a card on the canvas shows.
 *
 *  A text card is a small page: the same renderer the reading view uses, so a
 *  heading, a table and a `[[link]]` in a card look exactly like they would in a
 *  note. What it is not is the whole reading pipeline - no diagrams to draw, no
 *  embeds to fetch first - because a card is a paragraph or two and rendering it
 *  must not wait on anything.
 *
 *  Remembered by the words it came from. Rendering one card is nothing; rendering
 *  five hundred on every pan is a frozen surface, and a canvas that is only being
 *  looked at renders nothing at all. */

import { renderMarkdown } from '@nib/markdown'
import { assetUrl, joinPath } from '../tauri'
import { links } from '../link-index.svelte'
import { pointer } from '../reading/render'

/** How many cards' worth of HTML is worth keeping. Far more than a screenful,
 *  few enough that a long afternoon on a large canvas cannot grow without end. */
const MOST = 600

const cache = new Map<string, string>()
/** Which version of the link index the cache was built against. A note added or
 *  renamed changes which links resolve, so the answers are no longer answers. */
let at = -1

export function cardHtml(text: string, canvasPath: string | null): string {
  if (at !== links.version) {
    at = links.version
    cache.clear()
  }

  const key = `${canvasPath ?? ''}\n${text}`
  const held = cache.get(key)
  if (held !== undefined) return held

  const html = renderMarkdown(text, {
    footnotes: true,
    resolveLink: pointer({ text, path: canvasPath }),
  })

  // Cleared rather than trimmed one at a time: this only happens on a canvas of
  // hundreds of cards, and a map that big is cheaper to drop than to prune.
  if (cache.size >= MOST) cache.clear()
  cache.set(key, html)

  return html
}

const PICTURE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i

/** Whether a file node holds a picture rather than a note. A picture is shown as
 *  itself; anything else is read as markdown. */
export function isPicture(file: string): boolean {
  return PICTURE.test(file)
}

/** A file node's path as something the webview will load. The path is relative to
 *  the space, which is how JSON Canvas writes one. */
export function fileUrl(file: string, root: string | null): string {
  return root ? assetUrl(joinPath(root, file)) : file
}

/** The markdown of the note a file node names, or null when the space holds
 *  none. Read through the index, which keeps the last handful in hand so a
 *  screenful of cards on the same note costs one read. */
export function fileSource(file: string): Promise<string | null> {
  return links.embedSource(file, null)
}
