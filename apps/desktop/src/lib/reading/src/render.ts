import { type EmbeddedNote, renderMarkdown, type Wikilink } from '@orden/markdown'
import { attributeText, escapeAll } from '@orden/markdown/html'
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
    const found = links.targetOf(at, { kind: 'wikilink', target: link.target })
    return found === null ? null : { href: found }
  }
}

function noteFrom(target: string, from: EmbeddedNote): string | null {
  return from.path === undefined
    ? null
    : links.targetOf(from.path, { kind: 'markdown', target: decodeTarget(target) })
}

export function withPictures(html: string, note: Note): string {
  return mapSources(html, (src) => escapeAll(notePicture(attributeText(src), note.path, note.text)))
}

const MEASURE = 'orden:reading'

export const tagAnchor: TagHref = (tag) => `#${tag}`

export async function readingHtml(
  note: Note,
  scheme: Scheme,
  trusted: boolean,
  tagHref?: TagHref,
): Promise<string> {
  const { prepareEmbeds, prepareFences } = await import('../../fences/src/api')
  const root = note.path === null ? null : links.spaceOf(note.path)

  const [fence, embed] = await Promise.all([
    prepareFences(note.text, scheme, {
      query: (code) => queryRowsHtml(code, 'Nothing found', root),
      base: true,
    }),
    prepareEmbeds(note.text, (target) => links.embedNote(target, note.path)),
  ])

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
      resolveEmbed: embed,
      resolvePicture: picturesOf(note.path, note.text, assetUrl),
      ...(tagHref ? { tagHref } : {}),
    }),
    note,
  )
  performance.measure(MEASURE, { start: at, detail: { bytes: note.text.length } })

  return html
}

export function unreadableHtml(text: string): string {
  return `<pre class="unreadable">${escapeAll(text)}</pre>`
}
