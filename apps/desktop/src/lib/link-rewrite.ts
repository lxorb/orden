import {
  embedSize,
  encodeTarget,
  findLinks,
  type FoundLink,
  wikilinkCannotName,
} from '@orden/markdown/links'
import { formatLink } from './link-format'
import { shownName } from './note-name'
import { folderOf, nameOf, relativePath } from './space-paths'

export { encodeTarget }

export interface Placed {
  path: string
  reaches: (written: string) => boolean
}

export interface Move {
  from: string
  to: string
}

export function rewriteLinks(
  text: string,
  source: string,
  move: Move,
  points: (link: FoundLink) => boolean,
): string | null {
  return retargetLinks(text, source, (link) => (points(link) ? move.to : null))
}

export function retargetLinks(
  text: string,
  source: string,
  to: (link: FoundLink) => string | Placed | null,
): string | null {
  let out = ''
  let at = 0
  let any = false

  for (const link of findLinks(text)) {
    const there = to(link)
    if (there === null) continue
    any = true
    const written = targetFor(link, source, there)
    if (link.kind === 'wikilink' && wikilinkCannotName(written)) {
      out += text.slice(at, link.from) + asMarkdown(link, source, there)
      at = link.to
      continue
    }
    out += text.slice(at, link.targetFrom)
    out += written
    at = link.targetTo
  }

  return any ? out + text.slice(at) : null
}

function asMarkdown(link: FoundLink, source: string, placed: string | Placed): string {
  const path = typeof placed === 'string' ? placed : placed.path
  const fragment = link.block === null ? link.heading : `^${link.block}`
  const words = link.alias?.replace(/\\\|/g, '|') ?? null
  const shown = link.embed && embedSize(words) ? `|${words ?? ''}` : words
  return formatLink(
    {
      name: shownName(nameOf(path)),
      path,
      from: source,
      fragment,
      shown,
      embed: link.embed,
    },
    'relative',
  )
}

function targetFor(link: FoundLink, source: string, placed: string | Placed): string {
  const to = typeof placed === 'string' ? placed : placed.path
  if (link.kind === 'markdown') {
    if (link.target.startsWith('/')) return encodeTarget(`/${to}`)
    return encodeTarget(relativePath(folderOf(source), to))
  }

  const spelled = (path: string) =>
    shownName(link.target) === link.target ? shownName(path) : path
  const fromTop = spelled(`/${to}`)
  const reaches = (written: string) => typeof placed === 'string' || placed.reaches(written)

  if (link.target.startsWith('/')) return fromTop

  const parts = to.split('/')
  const first = link.target.includes('/') ? 0 : parts.length - 1
  for (let from = first; from >= 0; from--) {
    const written = spelled(parts.slice(from).join('/'))
    if (reaches(written)) return written
  }
  return fromTop
}
