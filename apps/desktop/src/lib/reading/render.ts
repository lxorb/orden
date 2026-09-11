/** The note as it reads: the HTML an export writes and a published page serves,
 *  built for a pane instead of for a file.
 *
 *  The same renderer, the same drawn diagrams, the same coloured fences, the same
 *  embedded notes, so what is read here is what anybody else is given. Two things
 *  differ, and both are about being inside the app rather than outside it: a
 *  wikilink points into the space, since there is a space to point into; and a
 *  picture keeps the path the note wrote, resolved to something the webview will
 *  load, rather than being carried inside the document. */

import { resolveFile, resolveNote } from '@nib/editor'
import { renderMarkdown, type Wikilink } from '@nib/markdown'
import { isTabFile } from '@nib/markdown/links'
import { mapSources } from '@nib/markdown/sources'
import { t } from '../i18n.svelte'
import { links } from '../link-index.svelte'
import { notePicture } from '../note-images'
import { queryRowsHtml } from '../query-block'
import type { Scheme } from '../theme.svelte'

/** The note being read: its words, and where it lives so that its links and its
 *  pictures resolve. `path` is null for a note with no home yet. */
export interface Note {
  text: string
  path: string | null
}

/** Where a wikilink points on this page: the note it names, relative to the
 *  space, which is what the workspace opens. A link nothing answers to is left as
 *  the words it showed, exactly as an export leaves it - a page that cannot go
 *  anywhere should not offer something that looks as if it could.
 *
 *  Exported because a canvas renders markdown too: a text card is a small page
 *  inside the app, and a link in one has to reach the same note it would reach in
 *  the reading view. */
export function pointer(note: Note): (link: Wikilink) => { href: string | null } | null {
  const index = links.index(note.path)

  return (link) => {
    // `[[#Heading]]` names a place on this very page, and the `#anchor` the
    // renderer writes after the target is the whole of what it needs.
    if (!link.target) return link.heading === null ? null : { href: '' }

    // A PDF is a file rather than a note, and the renderer writes the `#page=`
    // after it as the link had it; see `anchored` in the renderer.
    if (isTabFile(link.target)) {
      const file = resolveFile(index, link.target, 'wikilink')
      return file === null ? null : { href: file }
    }

    const found = resolveNote(index, link.target)
    return found ? { href: found.path } : null
  }
}

/** Every picture the note names, as something the webview will load. The same
 *  rewrite an export does on its way to `data:` URIs; see inlineImages.
 *
 *  Exported because a deck is the same note through the same renderer, one page
 *  of it at a time; see slides/render.ts. */
export function withPictures(html: string, note: Note): string {
  return mapSources(html, (src) => notePicture(src, note.path, note.text))
}

/** How long the last render took, under a name a profiler and a test can both
 *  read. Rendering a note is the one thing between pressing the key and seeing
 *  the page, so it is worth being able to ask. */
const MEASURE = 'nib:reading'

/** `trusted` is whether the HTML in the note is markup rather than the characters
 *  it is made of. A note the reader wrote is rendered the way Typora renders one;
 *  a note from a shared space, a room, a guest or a paste is not. The rule is
 *  trust.ts, and the caller has already asked it. */
export async function readingHtml(note: Note, scheme: Scheme, trusted: boolean): Promise<string> {
  // The exporter carries the diagram drawers and the syntax parsers, which are
  // most of what the app can load; asked for here rather than at startup, since
  // a note is read after the app is open.
  const { prepareEmbeds, prepareFences } = await import('../export')

  const [fence, embed] = await Promise.all([
    // A query fence is answered here, which is the one surface besides the editor
    // that can answer one: the app is around it and the space is on this machine.
    // See query-block.ts for why a published page leaves it as code.
    prepareFences(note.text, scheme, { query: (code) => queryRowsHtml(code, t('Nothing found')) }),
    prepareEmbeds(note.text, (target) => links.embedSource(target, note.path)),
  ])

  const at = performance.now()
  const html = withPictures(
    renderMarkdown(note.text, {
      footnotes: true,
      // The note's own metadata, as the rows the editor draws. Reading a note is
      // being in the app looking at it, so it says the same thing either way; a
      // document that has left does not, and no exporter asks for these.
      properties: true,
      toc: true,
      escapeHtml: !trusted,
      code: fence,
      resolveLink: pointer(note),
      resolveEmbed: embed,
    }),
    note,
  )
  performance.measure(MEASURE, { start: at, detail: { bytes: note.text.length } })

  return html
}
