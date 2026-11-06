import { Marked, Renderer, Tokenizer } from 'marked'
import { hardBreaks } from './breaks'
import type { Token, Tokens } from 'marked'
import { chartFigure } from './chart'
import { captionIn, languageIn } from './code'
import {
  type PropertiesMode,
  propertiesSource,
  propertiesTable,
  readProperties,
} from './properties'
import { withoutComments } from './comments'
import { type Cover, coverFigure, coverOf } from './cover'
import { stripFrontMatter } from './front-matter'
import { attributeUrl, escape, safeHref, safeSrc } from './html'
import { htmlBlockCard, ownMarkup } from './html-block'
import {
  blockAnchorsDrawn,
  blockMarksOff,
  blockIdsAnchored,
  isNoteTarget,
  sizedAlt,
  slugify,
  withoutBlockIds,
} from './links'
import { firstStart, lineStart, matchesAt } from './starts'
import { hashtags, type TagHref } from './tags'
import { iframeCard, isIframeTag, splitIframe, webCard } from './web-embed'
import {
  type EmbedResolver,
  type Embeds,
  embedSink,
  type LinkResolver,
  wikilinks,
} from './wikilinks'
import {
  abbreviations,
  callouts,
  collectAbbreviations,
  definitionLists,
  emoji,
  footnotes,
  highlight,
  maths,
  scripts,
} from './extensions'
import { noSetextHeadings } from './blocks'

export interface RenderOptions {
  footnotes?: boolean
  properties?: PropertiesMode
  cover?: boolean | Cover
  escapeHtml?: boolean
  toc?: boolean
  code?: (code: string, language: string) => string | null
  blockAnchors?: boolean
  resolveLink?: LinkResolver
  resolveNoteHref?: (target: string) => string | null
  tagHref?: TagHref
  resolveEmbed?: EmbedResolver
  breaks?: boolean
  locale?: string
  headings?: Heading[]
}

export { hardBreaks, setHardBreaks } from './breaks'

export interface CodeBlock {
  language: string
  code: string
}

export interface Heading {
  level: number
  text: string
  id: string
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

const defaults = Renderer.prototype as Renderer

const TOC_MARK = '<!--nib:toc-->'

const TOC_AT = /\[toc\][ \t]*(?=\r?\n|$)/iy
const TOC_NEEDLES = ['c]', 'C]']

const TOC_OPEN = 3

function tocLine(src: string, at: number): number | null {
  const open = at - TOC_OPEN
  if (open < 0) return null

  const line = lineStart(src, open, { orString: true })
  return line !== null && matchesAt(TOC_AT, src, open) ? line : null
}

const toc = {
  name: 'toc',
  level: 'block' as const,
  start: (src: string) => firstStart(src, TOC_NEEDLES, tocLine),
  tokenizer(src: string) {
    const match = /^\[toc\][ \t]*(?:\r?\n+|$)/i.exec(src)
    return match ? { type: 'toc', raw: match[0] } : undefined
  },
  renderer: () => `${TOC_MARK}\n`,
}

function noteLink(href: string): { target: string; fragment: string } | null {
  const written = href.trim()
  if (!written || written.startsWith('/') || written.startsWith('#')) return null
  if (!isNoteTarget(written)) return null

  const hash = written.indexOf('#')
  const target = hash === -1 ? written : written.slice(0, hash)
  if (!target || !NOTE_LINK.test(target)) return null

  return { target, fragment: hash === -1 ? '' : attributeUrl(written.slice(hash)) }
}

const NOTE_LINK = /\.(md|markdown|mdown|mkd|canvas|pages|pdf)$/i

const AN_ESCAPE = /\\([!-/:-@[-`{-~])/g

const PUNCTUATION = /^[!-/:-@[-`{-~]$/

function bareAddress(this: Tokenizer, src: string): Tokens.Link | undefined {
  const token = Tokenizer.prototype.url.call(this, src)
  if (!token) return undefined

  const ends = token.raw.endsWith('\\') && PUNCTUATION.test(src[token.raw.length] ?? '') ? 1 : 0
  const raw = token.raw.slice(0, token.raw.length - ends)
  const text = token.text.slice(0, token.text.length - ends).replace(AN_ESCAPE, '$1')
  return {
    ...token,
    raw,
    text,
    href: token.href.slice(0, token.href.length - ends).replace(AN_ESCAPE, '$1'),
    tokens: [{ type: 'text', raw: text, text }],
  }
}

function renderer(options: RenderOptions, headings: Heading[], embeds: Embeds) {
  const marked = new Marked({ gfm: true, breaks: false })
  marked.use(
    noSetextHeadings,
    maths,
    highlight,
    scripts,
    emoji,
    footnotes,
    callouts,
    definitionLists,
    abbreviations,
  )
  marked.use(
    wikilinks({
      embeds,
      ...(options.resolveLink ? { resolveLink: options.resolveLink } : {}),
      ...(options.resolveEmbed ? { resolveEmbed: options.resolveEmbed } : {}),
    }),
  )
  marked.use(hashtags(options.tagHref))
  marked.use({ tokenizer: { url: bareAddress } })

  const taken = new Map<string, number>()

  marked.use({
    renderer: {
      listitem(token: Tokens.ListItem) {
        const html = defaults.listitem.call(this, token)
        if (!token.task) return html

        const classes = token.checked ? 'task-list-item is-done' : 'task-list-item'
        return html.replace(/^<li>/, `<li class="${classes}">`)
      },

      link(token: Tokens.Link) {
        const body = this.parser.parseInline(token.tokens)

        const resolve = options.resolveNoteHref
        const written = resolve ? noteLink(token.href) : null
        if (resolve && written) {
          const found = resolve(written.target)
          if (found === null || !safeHref(found)) return body
          return `<a href="${attributeUrl(found)}${written.fragment}">${body}</a>`
        }

        const href = safeHref(token.href) ? attributeUrl(token.href) : ''
        if (!href) return body

        const bare =
          !token.raw.startsWith('[') || token.text.replace(AN_ESCAPE, '$1') === token.href
        const attributes = [bare ? ' class="url"' : '', ` href="${href}"`]
        if (token.title) attributes.push(` title="${escape(token.title)}"`)
        return `<a${attributes.join('')}>${body}</a>`
      },

      image(token: Tokens.Image) {
        const card = webCard(token.href)
        if (card) return card

        const { alt, size } = sizedAlt(
          this.parser.parseInline(token.tokens, this.parser.textRenderer),
        )
        const src = safeSrc(token.href) ? attributeUrl(token.href) : ''
        if (!src) return escape(alt)

        const attributes = [` src="${src}"`, ` alt="${escape(alt)}"`]
        if (size) attributes.push(` width="${String(size.width)}"`)
        if (size?.height) attributes.push(` height="${String(size.height)}"`)
        if (token.title) attributes.push(` title="${escape(token.title)}"`)
        return `<img${attributes.join('')}>`
      },

      heading(token: Tokens.Heading) {
        const html = defaults.heading.call(this, token)
        if (!options.toc) return html

        const text = plainText(html)
        const base = slugify(text)
        const seen = taken.get(base) ?? 0
        taken.set(base, seen + 1)
        const id = seen ? `${base}-${seen}` : base

        headings.push({ level: token.depth, text, id })
        return html.replace(/^<h(\d)>/, `<h$1 id="${id}">`)
      },

      code(token: Tokens.Code) {
        const info = token.lang?.trim() ?? ''
        const language = languageIn(info)

        if (language.toLowerCase() === 'chart') {
          const drawn = chartFigure(token.text, { locale: options.locale })
          if (drawn) return drawn
        }

        const custom = options.code?.(token.text, language)
        return captioned(custom ?? defaults.code.call(this, token), captionIn(info))
      },

      text(token: Tokens.Text | Tokens.Escape) {
        return defaults.text.call(this, 'escaped' in token ? { ...token, escaped: false } : token)
      },

      html(token: Tokens.HTML | Tokens.Tag) {
        const written = options.escapeHtml ? token.text : blockMarksOff(token.text)
        let text = written
        let cards = ''
        while (isIframeTag(text)) {
          const { tag, rest } = splitIframe(text)
          cards += iframeCard(tag) ?? ''
          text = rest
        }
        if (text !== written && !text.trim()) return cards
        if (options.escapeHtml) return cards + escape(text)

        return cards + (htmlBlockCard(text) ?? ownMarkup(text))
      },
    },
  })

  if (options.toc) marked.use({ extensions: [toc] })

  return marked
}

const trusting = renderer({}, [], embedSink())
const publishing = renderer({ escapeHtml: true }, [], embedSink())

export { frontMatter, frontMatterList, frontMatterValue, stripFrontMatter } from './front-matter'

export function documentTitle(source: string): string | null {
  return /^#\s+(.+)$/m.exec(stripFrontMatter(source))?.[1]?.trim() ?? null
}

function captioned(html: string, caption: string): string {
  if (!caption || html.startsWith('<figure')) return html

  return `<figure class="code">
<figcaption>${escape(caption)}</figcaption>
${html}</figure>
`
}

export function codeBlocks(source: string): CodeBlock[] {
  const found: CodeBlock[] = []

  if (!source.includes('```') && !source.includes('~~~')) return found

  void trusting.walkTokens(trusting.lexer(stripFrontMatter(source)), (token) => {
    if (token.type !== 'code') return
    const fence = token as Tokens.Code
    found.push({ language: languageIn(fence.lang ?? ''), code: fence.text })
  })

  return found
}

export function lexMarkdown(source: string): Token[] {
  return trusting.lexer(source)
}

function needsOwn(options: RenderOptions): boolean {
  return (
    options.toc === true ||
    options.code !== undefined ||
    options.resolveLink !== undefined ||
    options.resolveNoteHref !== undefined ||
    options.tagHref !== undefined ||
    options.resolveEmbed !== undefined ||
    options.headings !== undefined ||
    options.locale !== undefined
  )
}

function inside(options: RenderOptions): RenderOptions {
  const rest = { ...options }
  delete rest.resolveEmbed
  delete rest.toc
  delete rest.cover
  delete rest.blockAnchors
  return rest
}

function anchored(words: string): string {
  const cut = withoutComments(withoutBlockIds(words))
  let tokens: Token[]
  try {
    tokens = lexMarkdown(cut)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return withoutBlockIds(words)
  }

  const lines: (boolean | Set<string>)[] = []
  let above: boolean | Set<string> = false
  const newlines = (text: string) => text.split('\n').length - 1
  const read = cut.replace(/\r\n|\r/g, '\n')
  let at = 0
  let line = 0
  for (const token of tokens) {
    const whole = read.indexOf(token.raw, at)
    const raw = whole === -1 ? (token.raw.split('\n')[0] ?? '') : token.raw
    const from = whole === -1 ? read.indexOf(raw, at) : whole
    if (from === -1) continue
    line += newlines(read.slice(at, from))
    while (lines.length < line) lines.push(false)
    const here: boolean | Set<string> =
      token.type === 'space'
        ? above
        : token.type === 'paragraph' || token.type === 'table'
          ? true
          : token.type === 'list' || token.type === 'blockquote'
            ? leafLines(token)
            : false
    if (token.type !== 'space') above = here
    const last = line + newlines(raw) - (raw.endsWith('\n') ? 1 : 0)
    for (let one = lines.length; one <= last; one++) lines.push(here)
    line += newlines(raw)
    at = from + raw.length
  }

  return blockIdsAnchored(words, (line, kept) => {
    const here = lines[line] ?? above
    if (NO_ANCHOR.test(kept)) return false
    if (typeof here === 'boolean') return here
    const said = kept.trim()
    return said === '' || [...here].some((one) => said.endsWith(one))
  })
}

const NO_ANCHOR = /^\s*(?:>\s*)*(?:\[!|\*\[)/

function leafLines(token: Token): Set<string> {
  const out = new Set<string>()
  const walk = (one: Token) => {
    if (one.type === 'paragraph' || one.type === 'text') {
      for (const line of one.raw.split('\n')) if (line.trim()) out.add(line.trim())
      return
    }
    const inside = one as { tokens?: Token[]; items?: Token[] }
    for (const child of inside.tokens ?? inside.items ?? []) walk(child)
  }
  walk(token)
  return out
}

function parsedOrPlain(marked: Marked, body: string, breaks: boolean): string {
  try {
    return marked.parse(body, { async: false, breaks })
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return `<p>${escape(body)}</p>\n`
  }
}

export function renderMarkdown(source: string, options: RenderOptions = {}): string {
  const headings: Heading[] = options.headings ?? []
  const embeds = embedSink()
  const marked = needsOwn(options)
    ? renderer(options, headings, embeds)
    : options.escapeHtml
      ? publishing
      : trusting

  const words = stripFrontMatter(source)
  const body = withoutComments(options.blockAnchors ? anchored(words) : withoutBlockIds(words))
  let html = parsedOrPlain(marked, body, options.breaks ?? hardBreaks())
  if (options.blockAnchors) html = blockAnchorsDrawn(html)

  html = markAbbreviations(html, collectAbbreviations(body))

  if (options.toc) {
    const contents = tableOfContents(headings)
    html = html.replace(TOC_MARK, () => contents)
  }

  embeds.sections.forEach((section, at) => {
    const embedded = renderMarkdown(section.text, {
      ...inside(options),
      ...(section.escapeHtml ? { escapeHtml: true } : {}),
    })
    html = html.replace(embeds.marker(at), () => embedded)
  })

  if (options.footnotes) {
    html = html.replace(
      /(?:<li id="fn-[\s\S]*?<\/li>\n?)+/g,
      (block) => `<section class="footnotes"><ol>${block}</ol></section>`,
    )
  }

  if (options.properties === 'properties') {
    const rows = readProperties(source)
    html = (rows === null ? propertiesSource(source) : propertiesTable(rows)) + html
  } else if (options.properties === 'source') {
    html = propertiesSource(source) + html
  }

  if (!options.cover) return html
  return coverFigure(options.cover === true ? coverOf(source) : options.cover) + html
}

export function tableOfContents(headings: Heading[]): string {
  if (!headings.length) return ''

  const top = Math.min(...headings.map((heading) => heading.level))
  const out: string[] = ['<nav class="toc">', '<ul>']
  let depth = 0
  let last = top

  for (const heading of headings) {
    const wanted =
      heading.level > last
        ? depth + 1
        : heading.level < last
          ? Math.max(0, heading.level - top)
          : depth

    while (depth < wanted) {
      out.push('<ul>')
      depth++
    }
    while (depth > wanted) {
      out.push('</li>', '</ul>')
      depth--
    }
    if (out.at(-1) !== '<ul>') out.push('</li>')

    out.push(`<li><a href="#${heading.id}">${escape(heading.text)}</a>`)
    last = heading.level
  }

  while (depth > 0) {
    out.push('</li>', '</ul>')
    depth--
  }
  out.push('</li>', '</ul>', '</nav>')

  return out.join('\n')
}

function markAbbreviations(html: string, terms: Map<string, string>): string {
  if (!terms.size) return html

  const pattern = [...terms.keys()]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')

  const skip = /<(code|pre|abbr|script|style)\b[\s\S]*?<\/\1>|<[^>]+>|&[#\w]+;/g
  const word = new RegExp(`(?<![\\p{L}\\p{N}_])(${pattern})(?![\\p{L}\\p{N}_])`, 'gu')

  let out = ''
  let last = 0

  for (const match of html.matchAll(skip)) {
    out += text(html.slice(last, match.index))
    out += match[0]
    last = match.index + match[0].length
  }

  return out + text(html.slice(last))

  function text(chunk: string): string {
    return chunk.replace(
      word,
      (term) => `<abbr title="${escape(terms.get(term) ?? '')}">${term}</abbr>`,
    )
  }
}

export { noteWithoutComments, withoutComments } from './comments'

export { MOST_EMS } from './engines'

export { findLinks, type FoundLink, type Wikilink } from './links'
export type { EmbeddedNote } from './wikilinks'
