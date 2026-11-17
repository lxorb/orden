import { renderMarkdown, type Wikilink } from '@orden/markdown'
import { attributeText, escapeAll } from '@orden/markdown/html'
import { mapSources } from '@orden/markdown/sources'
import type { TagHref } from '@orden/markdown/tags'
import { keptCoverOf } from '../../workspace/src/api'
import { links, notePicture, queryRowsHtml } from '../../link-index/src/api'
import type { Scheme } from '../../theme/src/api'

export interface Note {
  text: string
  path: string | null
}

export function pointer(note: Note): (link: Wikilink) => { href: string | null } | null {
  return (link) => {
    if (!link.target) return link.heading === null && link.block === null ? null : { href: '' }

    const found = links.targetOf(note.path, { kind: 'wikilink', target: link.target })
    return found === null ? null : { href: found }
  }
}

export function withPictures(html: string, note: Note): string {
  return mapSources(html, (src) => escapeAll(notePicture(attributeText(src), note.path, note.text)))
}

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

  const at = performance.now()
  const html = scrollingTables(
    renderMarkdown(note.text, {
      footnotes: true,
      blockAnchors: true,
      cover: keptCoverOf(note.path) ?? true,
      toc: true,
      escapeHtml: !trusted,
      code: fence,
      resolveLink: pointer(note),
      ...(embed ? { resolveEmbed: embed } : {}),
      ...(tagHref ? { tagHref } : {}),
      pictures: (part, embedded) =>
        withPictures(part, embedded?.path ? { text: embedded.text, path: embedded.path } : note),
    }),
  )
  performance.measure(MEASURE, { start: at, detail: { bytes: note.text.length } })

  return html
}

export function unreadableHtml(text: string): string {
  return `<pre class="unreadable">${escapeAll(text)}</pre>`
}
