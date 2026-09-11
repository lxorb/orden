import { Marked, Renderer } from 'marked'
import type { Token, Tokens } from 'marked'
import { chartFigure } from './chart'
import { captionIn, languageIn } from './code'
import { propertiesTable, readProperties } from './properties'
import { withoutComments } from './comments'
import { stripFrontMatter } from './front-matter'
import { attributeUrl, escape, safeHref, safeSrc } from './html'
import { slugify, withoutBlockIds } from './links'
import { firstStart, lineStart, matchesAt } from './starts'
import { webCard } from './web-embed'
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

export interface RenderOptions {
  /** Gather footnote definitions into a list at the end. */
  footnotes?: boolean
  /** Show the note's front matter as rows above it, the way the editor draws
   *  one. For the reading view, which is the same note being read inside the
   *  app; a document that has left is a document, and its metadata is what the
   *  page furniture was built from rather than a table at the top of it. */
  properties?: boolean
  /** Render raw HTML as visible text instead of markup. Used when publishing:
   *  a note is authored content, and a public page must not run its scripts. */
  escapeHtml?: boolean
  /** Give every heading an id, and turn a `[toc]` line into a table of
   *  contents that links to them. */
  toc?: boolean
  /** Takes over a fenced code block: the HTML for the whole block, or null to
   *  leave it to the default. An export uses this to draw diagrams and to
   *  colour code, which need more than a renderer has. */
  code?: (code: string, language: string) => string | null
  /** Where a `[[wikilink]]` points on this page. Without it a wikilink renders
   *  as the words it showed, which is what an export wants: a document has no
   *  space around it to point into. */
  resolveLink?: LinkResolver
  /** What a `![[wikilink]]` shows: the markdown of the note it names. Without it
   *  an embed reads as a link. One level deep - a `![[…]]` inside an embedded
   *  note is rendered without this, so it comes out as a link of its own. */
  resolveEmbed?: EmbedResolver
  /** Keep a single newline as a line break instead of the space CommonMark
   *  makes of it.
   *
   *  Off everywhere a note is read as a document, which is what CommonMark says
   *  and what every other renderer does with the same file. On for a deck: a
   *  slide is a poster, its lines are placed rather than flowed, and three short
   *  lines run into one sentence is not the slide that was written. A blank line
   *  is still a paragraph, and the two-space hard break still works - this is a
   *  superset of it, not a replacement. See docs/slides.md. */
  breaks?: boolean
}

export interface CodeBlock {
  language: string
  code: string
}

interface Heading {
  level: number
  text: string
  id: string
}

/** Rendered inline HTML back to the words it shows. */
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

/** The default renderer's own methods, which an override calls to add a class or
 *  an id to what it produced.
 *
 *  Said out loud because `Renderer` is generic in what it renders to, and the
 *  prototype of a generic class comes back with its type arguments as `any` -
 *  so everything an override built on it would be untyped too. Here they are
 *  both strings: markdown in, HTML out, which is the only shape this uses. */
const defaults = Renderer.prototype as Renderer

const TOC_MARK = '<!--nib:toc-->'

/** The mark, wherever the closing bracket the scan found sits; see starts.ts.
 *  The two needles are the `c]` that every spelling of it ends in, in either
 *  case, which is enough for the pattern here to read the rest. */
const TOC_AT = /\[toc\][ \t]*(?=\r?\n|$)/iy
const TOC_NEEDLES = ['c]', 'C]']

/** How far back the `[` is from the `c]` the scan lands on. */
const TOC_OPEN = 3

function tocLine(src: string, at: number): number | null {
  const open = at - TOC_OPEN
  if (open < 0) return null

  const line = lineStart(src, open, { orString: true })
  return line !== null && matchesAt(TOC_AT, src, open) ? line : null
}

/** A `[toc]` alone on a line. Inside a sentence it stays text. */
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

/** One renderer, shared by export and the published blog, so a note looks the
 *  same wherever it is read. The headings list is filled in while rendering,
 *  which is why a renderer that numbers them is built per document. */
function renderer(options: RenderOptions, headings: Heading[], embeds: Embeds) {
  const marked = new Marked({ gfm: true, breaks: false })
  marked.use(maths, highlight, scripts, emoji, footnotes, callouts, definitionLists, abbreviations)
  // First among the inline extensions, so `[[…]]` is one link rather than a
  // link nested in another - the same reason the editor's parser puts it first.
  marked.use(
    wikilinks({
      embeds,
      ...(options.resolveLink ? { resolveLink: options.resolveLink } : {}),
      ...(options.resolveEmbed ? { resolveEmbed: options.resolveEmbed } : {}),
    }),
  )

  const taken = new Map<string, number>()

  marked.use({
    renderer: {
      // The default renderer knows how to draw a list item, a link and a
      // heading; these only add a class or an id to what it produced.
      listitem(token: Tokens.ListItem) {
        const html = defaults.listitem.call(this, token)
        if (!token.task) return html

        const classes = token.checked ? 'task-list-item is-done' : 'task-list-item'
        return html.replace(/^<li>/, `<li class="${classes}">`)
      },

      /** Written out here rather than delegated, because the default renderer
       *  puts the target into the attribute without asking what scheme it
       *  names, and without escaping the ampersand that could grow into one
       *  later. See html.ts. A target that fails the check leaves no `<a>` at
       *  all: the label stays as words, which is what the default does with a
       *  URL it cannot encode. */
      link(token: Tokens.Link) {
        const body = this.parser.parseInline(token.tokens)
        const href = safeHref(token.href) ? attributeUrl(token.href) : ''
        if (!href) return body

        // A bare address, or an autolink, stands for itself and says so.
        const bare = !token.raw.startsWith('[') || token.text === token.href
        const attributes = [bare ? ' class="url"' : '', ` href="${href}"`]
        if (token.title) attributes.push(` title="${escape(token.title)}"`)
        return `<a${attributes.join('')}>${body}</a>`
      },

      /** The same, for a picture. `data:` is allowed here and nowhere else:
       *  it is how a small image travels inside the document. */
      image(token: Tokens.Image) {
        // An address one of the handful of providers answers for is that page,
        // shown where it stands rather than a picture that was never there. A
        // card until the reader asks for it; see web-embed.ts.
        const card = webCard(token.href)
        if (card) return card

        // Through the text renderer, so markdown in the alt text comes out as
        // the words it stands for rather than as tags inside an attribute.
        const alt = this.parser.parseInline(token.tokens, this.parser.textRenderer)
        const src = safeSrc(token.href) ? attributeUrl(token.href) : ''
        if (!src) return escape(alt)

        const attributes = [` src="${src}"`, ` alt="${escape(alt)}"`]
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

        // A chart is numbers, and numbers can be drawn anywhere - here rather
        // than through `options.code` so a published page gets one too, which is
        // the one surface with no drawing library and no DOM to use it in. A
        // fence that holds no chart falls through and stays code.
        if (language.toLowerCase() === 'chart') {
          const drawn = chartFigure(token.text)
          if (drawn) return drawn
        }

        const custom = options.code?.(token.text, language)
        return captioned(custom ?? defaults.code.call(this, token), captionIn(info))
      },
    },
  })

  if (options.toc) marked.use({ extensions: [toc] })

  if (options.escapeHtml) {
    marked.use({
      renderer: {
        html: (token: Tokens.HTML | Tokens.Tag) => escape(token.text),
      },
    })
  }

  return marked
}

// The two plain renderers are built once; a renderer with a table of contents,
// or with a space to resolve links against, carries state and is built per
// document. Neither of these resolves anything, so their embed sinks are never
// filled in - a `![[…]]` in an export with no space behind it is a link.
const trusting = renderer({}, [], embedSink())
const publishing = renderer({ escapeHtml: true }, [], embedSink())

/** The note's metadata block lives in front-matter.ts, which knows how to change
 *  a key as well as how to read one. Named here as well because a renderer, an
 *  export and a document title are all callers of this module and all ask about
 *  it, and one import of `@nib/markdown` is what they should need. */
export { frontMatter, frontMatterList, frontMatterValue, stripFrontMatter } from './front-matter'

/** The first heading, or null when the note has none. */
export function documentTitle(source: string): string | null {
  return /^#\s+(.+)$/m.exec(stripFrontMatter(source))?.[1]?.trim() ?? null
}

/** A code block with what it is written over it.
 *
 *  Only a block that is still code. A fence the caller drew - a diagram - comes
 *  back as a figure of its own with its own frame, and a figure inside a figure
 *  is one frame too many; what such a block is, is what it is a picture of. */
function captioned(html: string, caption: string): string {
  if (!caption || html.startsWith('<figure')) return html

  return `<figure class="code">
<figcaption>${escape(caption)}</figcaption>
${html}</figure>
`
}

/** Every fenced block in the document, in order, with the language it names.
 *  Lets a caller prepare what a fence needs - a parser, a drawn diagram -
 *  before rendering, since rendering itself cannot wait. */
export function codeBlocks(source: string): CodeBlock[] {
  const found: CodeBlock[] = []

  // A fence is written with one of two marks, and finding neither is a byte scan
  // rather than a second reading of the whole note - which is what this used to
  // cost every export and every note opened for reading, fences or not.
  if (!source.includes('```') && !source.includes('~~~')) return found

  // The walk is over already; what it hands back is the callback's own returns,
  // which are nothing here.
  void trusting.walkTokens(trusting.lexer(stripFrontMatter(source)), (token) => {
    if (token.type !== 'code') return
    const fence = token as Tokens.Code
    found.push({ language: languageIn(fence.lang ?? ''), code: fence.text })
  })

  return found
}

/** The note as tokens, through the same grammar that renders it: GFM, plus the
 *  maths, the callouts, the definition lists, the emoji and the wikilinks this
 *  package adds. What a renderer that is not HTML stands on - the glasses draw
 *  from these - so that one grammar serves every face a note has.
 *
 *  Front matter is not stripped here, unlike in `renderMarkdown`: a caller that
 *  has to say where on the page a character of the file ended up needs the
 *  offsets to be the file's own, and can strip it and count the difference. */
export function lexMarkdown(source: string): Token[] {
  return trusting.lexer(source)
}

/** Whether a document needs a renderer of its own: one that keeps a headings
 *  list, draws its fences, or knows the space its links point into. */
function needsOwn(options: RenderOptions): boolean {
  return (
    options.toc === true ||
    options.code !== undefined ||
    options.resolveLink !== undefined ||
    options.resolveEmbed !== undefined
  )
}

/** How an embedded note is rendered: as its own document, minus the two things
 *  that belong to the page around it. No embed resolver, which is what makes an
 *  embed one level deep; and no table of contents, which is the outer note's. */
function inside(options: RenderOptions): RenderOptions {
  const rest = { ...options }
  delete rest.resolveEmbed
  delete rest.toc
  return rest
}

export function renderMarkdown(source: string, options: RenderOptions = {}): string {
  const headings: Heading[] = []
  const embeds = embedSink()
  const marked = needsOwn(options)
    ? renderer(options, headings, embeds)
    : options.escapeHtml
      ? publishing
      : trusting

  // Front matter is metadata, a block's name is a marker and a comment is a note
  // to the writer; none of the three is a word of the note, so none of them
  // reaches the page. See comments.ts for why the comment goes before the parse.
  const body = withoutComments(withoutBlockIds(stripFrontMatter(source)))
  // `breaks` is asked for per parse rather than built into the renderer, so the
  // two shared ones above serve a deck as well as a document: marked merges a
  // call's options over the instance's and leaves the instance alone.
  let html = marked.parse(body, { async: false, breaks: options.breaks === true })

  html = markAbbreviations(html, collectAbbreviations(body))

  if (options.toc) html = html.replace(TOC_MARK, tableOfContents(headings))

  // The notes inside embeds, rendered after the document around them so that
  // nothing re-enters the parser mid-parse.
  embeds.sections.forEach((section, at) => {
    html = html.replace(embeds.marker(at), renderMarkdown(section, inside(options)))
  })

  if (options.footnotes) {
    // Footnote definitions render as <li>; gather any trailing run into a list.
    html = html.replace(
      /(?:<li id="fn-[\s\S]*?<\/li>\n?)+/g,
      (block) => `<section class="footnotes"><ol>${block}</ol></section>`,
    )
  }

  if (!options.properties) return html

  // Above the note rather than inside it: the block was taken out before the
  // parse, and what it says is about the note rather than part of it. A block
  // whose shape cannot be read draws nothing here, the same answer the editor
  // gives - except that the editor can fall back to the source and a page has
  // nowhere to fall back to.
  const rows = readProperties(source)
  return rows === null || rows.length === 0 ? html : propertiesTable(rows) + html
}

/** Nested lists of links, one level deeper for each step down in heading
 *  level. A jump from h1 to h3 nests once, not twice, so a document that
 *  skips a level does not get an empty rung. */
function tableOfContents(headings: Heading[]): string {
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

/** Wraps each defined abbreviation in `<abbr>`, in text only - never inside a
 *  tag, an attribute, or a code element. */
function markAbbreviations(html: string, terms: Map<string, string>): string {
  if (!terms.size) return html

  // Longest first, so `HTML5` wins over `HTML` where both are defined.
  const pattern = [...terms.keys()]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')

  const skip = /<(code|pre|abbr|script|style)\b[\s\S]*?<\/\1>|<[^>]+>/g
  const word = new RegExp(`\\b(${pattern})\\b`, 'g')

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

export { withoutComments } from './comments'
export {
  abbreviations,
  callouts,
  definitionLists,
  emoji,
  footnotes,
  highlight,
  maths,
  MOST_EMS,
  scripts,
} from './extensions'
// The link grammar is its own module - `@nib/markdown/links` - so the editor can
// have it without the renderer that stands on it. Passed on from here too, for
// everything that already reads this package.
export {
  blockIdOf,
  blockIds,
  findLinks,
  type FoundLink,
  formatWikilink,
  isNoteTarget,
  type LinkKind,
  linkTarget,
  parseWikilink,
  sectionOf,
  shownSpan,
  shownText,
  slugify,
  type Wikilink,
} from './links'
