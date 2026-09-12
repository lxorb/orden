/** A diagram fence, on a surface that cannot draw one.
 *
 *  Mermaid measures its own text before it lays a box out, so it needs a DOM;
 *  flowchart.js needs one twice over. The app has one, and the Worker that serves
 *  a published page has none - which is why a ` ```mermaid ` fence used to come
 *  out as a code block on the page while the app drew it. Carrying mermaid into
 *  the Worker was the other way out, and it was refused for the reason the KaTeX
 *  round refused a CDN: a megabyte of drawing library on every cold start of every
 *  site, for the pages that have no diagram, and a third party watching the reader
 *  if it came from somewhere else.
 *
 *  So the side that has a DOM draws it, exactly as the favicon and the author's
 *  theme are drawn by the app and sent up as blobs: the app renders each diagram
 *  to an SVG, names it by this module's `diagramKey`, and uploads it. The page
 *  writes the figure below where the fence stood if the blob is there, and keeps
 *  the code block while it is not - so a note published from a device that has
 *  never drawn it still reads, and nothing on the page ever waits on anything.
 *
 *  Both halves of that are here rather than in either place, because the name has
 *  to be the same on both sides of the wire: the app computes it to decide where
 *  to put the bytes, and the Worker computes it to decide whether they are there.
 *  Two spellings of one hash would be a diagram that is drawn and never shown.
 *
 *  See docs/publishing.md, apps/desktop/src/lib/site-diagrams.ts for the drawing
 *  and the upload, and services/sync/src/blog.ts for the replacement. */

import { escape } from './html'

/** Fence languages that are a picture rather than code.
 *
 *  The one list, imported by @nib/editor for the widget that draws them in the
 *  editor and by the exporter that draws them into a document. `chart` is not
 *  here: a chart is numbers and is built as a string of SVG on any surface,
 *  including the Worker, so it never needed a blob. */
export const DIAGRAM_LANGUAGES: ReadonlySet<string> = new Set(['mermaid', 'flow', 'sequence'])

/** Whatever a fence opened with, as this module reads it: a language is a word
 *  and its case is the writer's business. */
export function isDiagram(language: string): boolean {
  return DIAGRAM_LANGUAGES.has(language.toLowerCase())
}

/** Which way round a diagram is drawn.
 *
 *  Two pictures per diagram rather than one, and this is the part of the design
 *  worth writing down. A diagram's colours come from the scheme it is drawn in -
 *  mermaid writes them into a `<style>` inside the SVG - and a published page
 *  lets the reader choose the scheme, so the picture has to follow.
 *
 *  One file with the page's own custom properties in it cannot: an `<img>` is a
 *  document of its own, and neither the page's variables nor its stylesheet reach
 *  inside it. One file switching on `prefers-color-scheme` inside its own `<style>`
 *  cannot either, for a subtler reason: that media query answers the reader's
 *  *system*, and the button in the bar of a published page is a reader saying
 *  something else - so a reader who asks for dark on a light machine would get a
 *  light diagram on a dark page.
 *
 *  What does work is two files and the page choosing, which is what the sheet
 *  does: both are written into the figure and the one for the scheme in force is
 *  the one shown. The cost is the second file being fetched as well; it is a few
 *  kilobytes, served from the site's own domain, immutable for ever, and only on a
 *  page that has a diagram on it at all. */
export type DiagramScheme = 'light' | 'dark'

export const DIAGRAM_SCHEMES: readonly DiagramScheme[] = ['light', 'dark']

/** How a diagram's blob is named.
 *
 *  The fence's own contents, the word it opened with and the scheme, hashed: an
 *  unchanged diagram is the same name on the next publish and costs nothing at
 *  all, and an edited one is a new name rather than a stale picture under an old
 *  one. Which is the same reason every other blob is named by a hash.
 *
 *  The space is in it too, and that is not for uniqueness. A blob is addressed by
 *  its name alone and the store lets any account write any name, so a name
 *  derived from text a stranger can read off the page would be a name a stranger
 *  could compute and write to. The space's id is a uuid that no published page
 *  ever prints, so it is what keeps the name unguessable - and it costs the
 *  deduplication only between spaces, where two authors' diagrams are two
 *  authors' anyway. The Worker asks for the hash under the space owner's own
 *  account on top of that; see `heldBlobs` in services/sync/src/blog.ts. */
export async function diagramKey(
  spaceId: string,
  language: string,
  code: string,
  scheme: DiagramScheme,
): Promise<string> {
  const said = `nib/diagram/v1\n${spaceId}\n${language.toLowerCase()}\n${scheme}\n${code}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(said))

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** What a reader who cannot see the picture is told it says.
 *
 *  Mermaid has two words for this - `accTitle` and `accDescr` - and an author who
 *  has written either has said what the diagram is better than anything here
 *  could. An author who has not gets the one honest thing left, which is that this
 *  is a diagram: the fence's first line is `graph TD`, and reading that out is
 *  worse than saying nothing. */
export function diagramAlt(code: string): string {
  const described = /^\s*accDescr\s*:\s*(.+)$/m.exec(code)?.[1]
  const titled = /^\s*accTitle\s*:\s*(.+)$/m.exec(code)?.[1]
  const said = (described ?? titled)?.trim()

  return said === undefined || said === '' ? 'Diagram' : said
}

/** The figure a drawn fence becomes on a published page.
 *
 *  The same `figure.diagram` an export writes around the SVG it inlines, so the
 *  one rule in document.css dresses both and a page and a PDF of the same note
 *  frame their diagrams alike. A picture rather than the markup because the bytes
 *  are a blob the reader's browser keeps: the second page of a site that shows the
 *  same diagram fetches nothing.
 *
 *  `dark` is null where only the light drawing is there - a device that sent one
 *  and not the other - and then the one picture is what everybody sees, which beats
 *  an empty frame. */
export function diagramFigure(
  language: string,
  alt: string,
  sources: { light: string; dark: string | null },
): string {
  const picture = (src: string, scheme?: DiagramScheme) =>
    `<img src="${escape(src)}" alt="${escape(alt)}"${scheme ? ` data-scheme="${scheme}"` : ''}>`

  const images =
    sources.dark === null
      ? picture(sources.light)
      : picture(sources.light, 'light') + picture(sources.dark, 'dark')

  return `<figure class="diagram" data-language="${escape(language)}">${images}</figure>\n`
}
