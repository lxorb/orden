import { type EmbeddedNote, renderMarkdown, type Wikilink } from '@orden/markdown'
import { attributeText, attributeUrl, escapeAll } from '@orden/markdown/html'
import { decodeTarget } from '@orden/markdown/links'
import { mapSources } from '@orden/markdown/sources'
import type { TagHref } from '@orden/markdown/tags'
import { keptCoverOf } from '../../workspace/src/api'
import { links, notePicture, picturesOf, queryRowsHtml } from '../../link-index/src/api'
import { assetUrl } from '../../platform/src/api'
import type { Scheme } from '../../theme/src/api'

export interface Note {
  text: string
  path: string | null
}

export function pointer(
  note: Note,
): (link: Wikilink, from?: EmbeddedNote) => { href: string | null } | null {
  return (link, from) => {
    if (!link.target) return link.heading === null && link.block === null ? null : { href: '' }

    const at = from?.path ?? note.path
    const found = links.reachedOf(at, { kind: 'wikilink', target: link.target })
    return found === null ? null : { href: found }
  }
}

const noteFrom = (target: string, from: EmbeddedNote): string | null =>
  from.path === undefined
    ? null
    : links.targetOf(from.path, { kind: 'markdown', target: decodeTarget(target) })

export const withPictures = (
  html: string,
  note: Note,
  drawn: ReadonlySet<string> = new Set(),
): string =>
  mapSources(html, (src) =>
    drawn.has(src) ? null : escapeAll(notePicture(attributeText(src), note.path, note.text)),
  )

const TABLE = /<table>[\s\S]*?<\/table>/g

function scrollingTables(html: string): string {
  return html.replace(TABLE, (table) => `<div class="reading-table">${table}</div>`)
}

const MEASURE = 'orden:reading'
export const tagAnchor: TagHref = (tag) => `#${tag}`

export async function readingHtml(
  note: Note,
  scheme: Scheme,
  trusted: boolean,
  tagHref?: TagHref,
): Promise<string> {
  const { prepareNote } = await import('../../fences/src/api')
  const root = note.path === null ? null : links.spaceOf(note.path)

  const { fence, embed } = await prepareNote(
    note.text,
    scheme,
    (target) => links.embedNote(target, note.path),
    { query: (code) => queryRowsHtml(code, 'Nothing found', root), base: true },
  )

  const drawn = new Set<string>()
  const drawing = (path: string) => {
    const url = assetUrl(path)
    drawn.add(attributeUrl(url))
    return url
  }

  const at = performance.now()
  const html = withPictures(
    renderMarkdown(note.text, {
      footnotes: true,
      blockAnchors: true,
      cover: keptCoverOf(note.path) ?? true,
      toc: true,
      escapeHtml: !trusted,
      code: fence,
      resolveLink: pointer(note),
      resolveNoteFrom: noteFrom,
      ...(embed ? { resolveEmbed: embed } : {}),
      resolvePicture: picturesOf(note.path, note.text, drawing),
      ...(tagHref ? { tagHref } : {}),
    }),
    note,
    drawn,
  )
  performance.measure(MEASURE, { start: at, detail: { bytes: note.text.length } })

  return scrollingTables(html)
}

export function unreadableHtml(text: string): string {
  return `<pre class="unreadable">${escapeAll(text)}</pre>`
}
