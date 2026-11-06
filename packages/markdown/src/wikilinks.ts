import type { MarkedExtension, Tokens } from 'marked'
import { attributeUrl, escape, fragment, safeHref } from './html'
import { DOCUMENT, iconMarkup, PLANE } from './icons'
import {
  embedKind,
  embedSize,
  pageFragment,
  parseWikilink,
  sectionOf,
  shownText,
  slugify,
  type Wikilink,
  WIKILINK_INNER as INNER,
} from './links'
import { firstStart, lineStart, matchesAt } from './starts'
import { remembering } from './tags'

export type LinkResolver = (link: Wikilink) => { href: string | null; text?: string } | null

export type EmbedResolver = (link: Wikilink) => string | EmbeddedNote | null

export interface EmbeddedNote {
  text: string
  escapeHtml: boolean
}

export interface Embeds {
  sections: { text: string; escapeHtml: boolean }[]
  marker: (at: number) => string
}

export function embedSink(): Embeds {
  const stamp = Math.random().toString(36).slice(2, 10)
  return { sections: [], marker: (at) => `<!--nib:embed:${stamp}:${at}-->` }
}

const EMBED_LINE = new RegExp(`^!\\[\\[(${INNER})\\]\\][ \\t]*(?:\\r?\\n+|$)`)

const EMBED_AT = new RegExp(`!\\[\\[${INNER}\\]\\][ \\t]*(?=\\r?\\n|$)`, 'y')

const WIKILINK_AT_START = new RegExp(`^(!?)\\[\\[(${INNER})\\]\\]`)

function embedLine(src: string, at: number): number | null {
  const line = lineStart(src, at, { orString: true })
  return line !== null && matchesAt(EMBED_AT, src, at) ? line : null
}

export function wikilinks(options: {
  resolveLink?: LinkResolver
  resolveEmbed?: EmbedResolver
  embeds: Embeds
}): MarkedExtension {
  return remembering({
    extensions: [
      {
        name: 'embed',
        level: 'block',
        start: (src: string) => firstStart(src, ['![['], embedLine),
        tokenizer(src: string) {
          const match = EMBED_LINE.exec(src)
          if (!match) return undefined

          const link = parseWikilink(match[1] ?? '', true)
          if (!link) return undefined

          return { type: 'embed', raw: match[0], text: shownText(link), link }
        },
        renderer(token: Tokens.Generic) {
          const link = token.link as Wikilink
          const shown = media(link) ?? card(link, options) ?? frame(link, options)

          return shown ?? `<p>${anchor(link, options.resolveLink, String(token.text ?? ''))}</p>\n`
        },
      },
      {
        name: 'wikilink',
        level: 'inline',
        start: (src: string) => /(?<!\\)!?\[\[/.exec(src)?.index,
        tokenizer(src: string) {
          const match = WIKILINK_AT_START.exec(src)
          if (!match) return undefined

          const link = parseWikilink(match[2] ?? '', match[1] === '!')
          if (!link) return undefined

          return { type: 'wikilink', raw: match[0], text: shownText(link), link }
        },
        renderer(token: Tokens.Generic) {
          const link = token.link as Wikilink
          const shown = link.embed ? media(link) : null

          return shown ?? anchor(link, options.resolveLink, String(token.text ?? ''))
        },
      },
    ],
  })
}

function anchor(link: Wikilink, resolve: LinkResolver | undefined, text: string): string {
  const resolved = resolve?.(link) ?? null
  const target = resolved?.href ?? null
  const words = escape(resolved?.text ?? text)

  if (target === null || !safeHref(target)) return words

  return `<a class="wikilink" href="${attributeUrl(target)}${anchored(link)}">${words}</a>`
}

function anchored(link: Wikilink): string {
  if (link.block !== null) return `#${fragment(`^${link.block}`)}`
  if (link.heading === null) return ''

  const page = pageFragment(link.heading)
  return page === null ? `#${fragment(slugify(link.heading))}` : `#page=${page}`
}

function media(link: Wikilink): string | null {
  const kind = embedKind(link.target)
  if (kind === null || kind === 'pdf' || kind === 'canvas') return null

  const source = safeHref(link.target) ? attributeUrl(link.target) : ''
  if (!source) return null

  const size = embedSize(link.alias)
  const sized = size
    ? ` width="${size.width}"${size.height === null ? '' : ` height="${size.height}"`}`
    : ''
  const words = size === null ? (link.alias ?? '') : ''

  if (kind === 'image') return `<img src="${source}" alt="${escape(words)}"${sized}>`

  const tag = kind === 'video' ? 'video' : 'audio'
  const named = words ? ` title="${escape(words)}"` : ''

  return `<${tag} class="embed-media" controls preload="metadata" src="${source}"${sized}${named}></${tag}>\n`
}

function card(link: Wikilink, options: { resolveLink?: LinkResolver }): string | null {
  const kind = embedKind(link.target)
  if (kind !== 'pdf' && kind !== 'canvas' && kind !== 'base') return null

  const icon = iconMarkup(kind === 'pdf' ? DOCUMENT : PLANE, 'embed-icon')
  const name = anchor(link, options.resolveLink, shownText(link))

  const page = kind === 'pdf' ? pageFragment(link.heading) : null
  const asked =
    page !== null
      ? ` data-page="${page}"`
      : kind === 'base' && link.heading
        ? ` data-view="${escape(link.heading)}"`
        : ''

  return (
    `<figure class="embed embed-file" data-kind="${kind}"` +
    ` data-file="${escape(link.target)}"${asked}>${icon}${name}</figure>\n`
  )
}

function frame(
  link: Wikilink,
  options: { resolveEmbed?: EmbedResolver; embeds: Embeds },
): string | null {
  const found = options.resolveEmbed?.(link) ?? null
  if (found === null) return null

  const note = typeof found === 'string' ? { text: found, escapeHtml: false } : found
  const section = sectionOf(note.text, link)
  if (section === null) return null

  const at = options.embeds.sections.push({ text: section, escapeHtml: note.escapeHtml }) - 1
  const name = escape(shownText(link))

  return `<figure class="embed">\n<div class="embed-body">${options.embeds.marker(
    at,
  )}</div>\n<figcaption>${name}</figcaption>\n</figure>\n`
}
