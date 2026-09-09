/** `[[wikilinks]]` and `![[embeds]]` as HTML.
 *
 *  The grammar is in links.ts, which is also what the editor reads; this is only
 *  what the two become on a page. And what they become depends on where the page
 *  is: an exported document knows nothing about the space it came from, while a
 *  published blog knows the URL of every note in it. So the caller answers, in
 *  `RenderOptions.resolveLink` and `resolveEmbed`, and a link nobody can resolve
 *  comes out as the words it showed rather than as a link to nowhere.
 *
 *  Every target goes through `safeHref` and `attributeUrl` on the way into an
 *  `href`, like any other link: a wikilink names a target an author wrote, and a
 *  published note is served to strangers from a shared domain. */

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
} from './links'
import { firstStart, lineStart, matchesAt } from './starts'

/** Where a note's name goes on this page: an `href`, or null for a link the
 *  caller cannot place, which renders as the words it showed. `text` is there for
 *  a caller that knows a better name for the note than the target it was given. */
export type LinkResolver = (link: Wikilink) => { href: string | null; text?: string } | null

/** The markdown of the note an embed names, or null when there is none. */
export type EmbedResolver = (link: Wikilink) => string | null

/** An embed's content is rendered after the document around it, the way a
 *  `[toc]` is: this is what stands in its place until then.
 *
 *  Stamped with a number nobody could have written, so that raw HTML in a note -
 *  which an export passes through unescaped - cannot claim to be an embed. */
export interface Embeds {
  /** The sections found, in the order they were met. */
  sections: string[]
  /** What marks each one's place. */
  marker: (at: number) => string
}

export function embedSink(): Embeds {
  const stamp = Math.random().toString(36).slice(2, 10)
  return { sections: [], marker: (at) => `<!--nib:embed:${stamp}:${at}-->` }
}

/** Everything between the brackets of one link, and nothing else: a link takes
 *  one line and holds no brackets of its own, where Obsidian ends one too. */
const INNER = '[^[\\]\\n]+'

/** An embed with a line to itself, which is where it shows the note rather than
 *  a link to it - the same rule the editor draws by. */
const EMBED_LINE = new RegExp(`^!\\[\\[(${INNER})\\]\\][ \\t]*(?:\\r?\\n+|$)`)

/** The same line, matched where an `![[` the scan found sits; see starts.ts. */
const EMBED_AT = new RegExp(`!\\[\\[${INNER}\\]\\][ \\t]*(?=\\r?\\n|$)`, 'y')

/** Where the next embed on a line of its own begins: the newline before it, or
 *  the start of the string when it begins there. */
function embedLine(src: string, at: number): number | null {
  const line = lineStart(src, at, { orString: true })
  return line !== null && matchesAt(EMBED_AT, src, at) ? line : null
}

/** `[[Note]]`, `[[Note|shown]]`, `[[Note#Heading]]`, `![[Note]]`.
 *
 *  Two extensions, because the two are different shapes of thing. An embed alone
 *  on its line is a block - a figure cannot live inside a paragraph, and a
 *  browser would close the paragraph around it and leave the frame in pieces.
 *  Everywhere else a link, an embed included, is inline. */
export function wikilinks(options: {
  resolveLink?: LinkResolver
  resolveEmbed?: EmbedResolver
  embeds: Embeds
}): MarkedExtension {
  return {
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
        // A backslash escapes the bracket, so `\[[Note]]` is words.
        start: (src: string) => /(?<!\\)!?\[\[/.exec(src)?.index,
        tokenizer(src: string) {
          const match = new RegExp(`^(!?)\\[\\[(${INNER})\\]\\]`).exec(src)
          if (!match) return undefined

          const link = parseWikilink(match[2] ?? '', match[1] === '!')
          if (!link) return undefined

          return { type: 'wikilink', raw: match[0], text: shownText(link), link }
        },
        renderer(token: Tokens.Generic) {
          const link = token.link as Wikilink
          // A picture, a recording or a film is what it is wherever it is
          // written, which is how the editor draws one too. A note and a
          // document are not: neither fits inside a sentence, so inline they
          // read as a link to themselves.
          const shown = link.embed ? media(link) : null

          return shown ?? anchor(link, options.resolveLink, String(token.text ?? ''))
        },
      },
    ],
  }
}

/** A link as an anchor, or as the words it showed when it points nowhere. */
function anchor(link: Wikilink, resolve: LinkResolver | undefined, text: string): string {
  const resolved = resolve?.(link) ?? null
  const target = resolved?.href ?? null
  const words = escape(resolved?.text ?? text)

  // An unresolved link is plain text: a page nobody can navigate should not
  // offer something that looks navigable. The `link` renderer in index.ts does
  // the same for a target it cannot encode.
  if (target === null || !safeHref(target)) return words

  return `<a class="wikilink" href="${attributeUrl(target)}${anchored(link)}">${words}</a>`
}

/** The `#…` an anchor carries: the page of a PDF as it was written, since that
 *  is what a PDF viewer reads, and a heading as the id it becomes on the page. */
function anchored(link: Wikilink): string {
  if (link.heading === null) return ''

  const page = pageFragment(link.heading)
  return page === null ? `#${fragment(slugify(link.heading))}` : `#page=${page}`
}

/** What an embedded picture, recording or film is drawn as: the element for it,
 *  pointed at the file the way `![](…)` points at one, so every surface can
 *  swap the address the same way it swaps a picture's; see sources.ts.
 *
 *  Plainly, with no frame and no caption. That is what the editor already draws
 *  for `![[pic.png]]`, and the reason holds for the other two: a player is
 *  already a box with its own furniture, and a name printed under it says
 *  nothing the file name in the note did not.
 *
 *  Null for anything else, which is a note or a document.
 *
 *  `preload="metadata"` and no `autoplay`: opening a note should cost the length
 *  of the recording, not the recording. */
function media(link: Wikilink): string | null {
  const kind = embedKind(link.target)
  if (kind === null || kind === 'pdf' || kind === 'canvas') return null

  const source = safeHref(link.target) ? attributeUrl(link.target) : ''
  if (!source) return null

  const size = embedSize(link.alias)
  const sized = size
    ? ` width="${size.width}"${size.height === null ? '' : ` height="${size.height}"`}`
    : ''
  // Anything after the bar that is not a size is what the thing is, as in
  // markdown. A player has no alt text, so it names itself instead.
  const words = size === null ? (link.alias ?? '') : ''

  if (kind === 'image') return `<img src="${source}" alt="${escape(words)}"${sized}>`

  const tag = kind === 'video' ? 'video' : 'audio'
  const named = words ? ` title="${escape(words)}"` : ''

  return `<${tag} class="embed-media" controls preload="metadata" src="${source}"${sized}${named}></${tag}>\n`
}

/** What an embedded PDF or canvas is drawn as: a card naming the file, which
 *  opens it.
 *
 *  Neither can be shown where it stands. A paper is pages, and which page is
 *  wanted is written in the link rather than in the file; a plane is a surface
 *  somebody moves around on. Both are things the app opens in a tab of their
 *  own, and a card that says which one and takes one click is the whole of what
 *  the reader came for. Where the card cannot be clicked - an export, which has
 *  no space behind it - it is still the file's name, said once.
 *
 *  Null for every other kind. */
function card(link: Wikilink, options: { resolveLink?: LinkResolver }): string | null {
  const kind = embedKind(link.target)
  if (kind !== 'pdf' && kind !== 'canvas') return null

  const icon = iconMarkup(kind === 'pdf' ? DOCUMENT : PLANE, 'embed-icon')
  const name = anchor(link, options.resolveLink, shownText(link))

  return `<figure class="embed embed-file" data-kind="${kind}">${icon}${name}</figure>\n`
}

/** The frame an embedded note sits in, with a marker where its content goes.
 *  Null when there is no such note, or no such heading in it, which leaves the
 *  embed to read as a link. */
function frame(
  link: Wikilink,
  options: { resolveEmbed?: EmbedResolver; embeds: Embeds },
): string | null {
  const source = options.resolveEmbed?.(link) ?? null
  if (source === null) return null

  const section = sectionOf(source, link)
  if (section === null) return null

  const at = options.embeds.sections.push(section) - 1
  const name = escape(shownText(link))

  return `<figure class="embed">\n<div class="embed-body">${options.embeds.marker(
    at,
  )}</div>\n<figcaption>${name}</figcaption>\n</figure>\n`
}
