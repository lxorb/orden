import { renderMarkdown, type Wikilink } from '@orden/markdown'
import { escapeAll } from '@orden/markdown/html'
import { mapSources } from '@orden/markdown/sources'
import type { TagHref } from '@orden/markdown/tags'
import { keptCoverOf } from '../../kept-cover'
import { links } from '../../link-index.svelte'
import { notePicture } from '../../note-images'
import { queryRowsHtml } from '../../query-block'
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
  return mapSources(html, (src) => notePicture(src, note.path, note.text))
}

const MEASURE = 'orden:reading'

export const tagAnchor: TagHref = (tag) => `#${tag}`

export async function readingHtml(
  note: Note,
  scheme: Scheme,
  trusted: boolean,
  tagHref?: TagHref,
): Promise<string> {
  const { prepareEmbeds, prepareFences } = await import('../../before-render')
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
      resolveEmbed: embed,
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
