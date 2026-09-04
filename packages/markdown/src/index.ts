import { Marked, Renderer } from 'marked'
import type { Tokens } from 'marked'
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

function escape(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
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

/** The id a heading gets, the way GitHub forms them: lowercase words joined
 *  with hyphens, letters of any script kept. */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  )
}

const TOC_MARK = '<!--nib:toc-->'

/** A `[toc]` alone on a line. Inside a sentence it stays text. */
const toc = {
  name: 'toc',
  level: 'block' as const,
  start: (src: string) => {
    const at = src.search(/(^|\n)\[toc\][ \t]*(?=\r?\n|$)/i)
    return at < 0 ? undefined : at
  },
  tokenizer(src: string) {
    const match = /^\[toc\][ \t]*(?:\r?\n+|$)/i.exec(src)
    return match ? { type: 'toc', raw: match[0] } : undefined
  },
  renderer: () => `${TOC_MARK}\n`,
}

/** One renderer, shared by export and the published blog, so a note looks the
 *  same wherever it is read. The headings list is filled in while rendering,
 *  which is why a renderer that numbers them is built per document. */
function renderer(options: RenderOptions, headings: Heading[]) {
  const marked = new Marked({ gfm: true, breaks: false })
  marked.use(maths, highlight, scripts, emoji, footnotes, callouts, definitionLists, abbreviations)

  const taken = new Map<string, number>()

  marked.use({
    renderer: {
      // The default renderer knows how to draw a list item, a link and a
      // heading; these only add a class or an id to what it produced.
      listitem(token: Tokens.ListItem) {
        const html = Renderer.prototype.listitem.call(this as Renderer, token)
        if (!token.task) return html

        const classes = token.checked ? 'task-list-item is-done' : 'task-list-item'
        return html.replace(/^<li>/, `<li class="${classes}">`)
      },

      link(token: Tokens.Link) {
        const html = Renderer.prototype.link.call(this as Renderer, token)
        const bare = !token.raw.startsWith('[') || token.text === token.href
        return bare ? html.replace(/^<a /, '<a class="url" ') : html
      },

      heading(token: Tokens.Heading) {
        const html = Renderer.prototype.heading.call(this as Renderer, token)
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
        const custom = options.code?.(token.text, token.lang?.trim() ?? '')
        return custom ?? Renderer.prototype.code.call(this as Renderer, token)
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

// The two plain renderers are built once; a renderer with a table of contents
// carries state and is built per document.
const trusting = renderer({}, [])
const publishing = renderer({ escapeHtml: true }, [])

/** Strips YAML front matter, which is metadata rather than content. */
export function stripFrontMatter(source: string): string {
  return source.startsWith('---')
    ? source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    : source
}

export function frontMatter(source: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  return match ? match[1] : null
}

/** A top-level `key: value` from the front matter, quotes stripped. Nested
 *  keys are not reached: `paper` under `export:` is not a document field. */
export function frontMatterValue(source: string, key: string): string | null {
  const block = frontMatter(source)
  if (!block) return null

  for (const line of block.split('\n')) {
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!pair || pair[1].toLowerCase() !== key.toLowerCase()) continue

    const value = pair[2].trim().replace(/^(["'])(.*)\1$/, '$2')
    return value || null
  }

  return null
}

/** The first heading, or null when the note has none. */
export function documentTitle(source: string): string | null {
  const match = /^#\s+(.+)$/m.exec(stripFrontMatter(source))
  return match ? match[1].trim() : null
}

/** Every fenced block in the document, in order, with the language it names.
 *  Lets a caller prepare what a fence needs - a parser, a drawn diagram -
 *  before rendering, since rendering itself cannot wait. */
export function codeBlocks(source: string): CodeBlock[] {
  const found: CodeBlock[] = []

  trusting.walkTokens(trusting.lexer(stripFrontMatter(source)), (token) => {
    if (token.type === 'code') {
      found.push({ language: (token as Tokens.Code).lang?.trim() ?? '', code: token.text })
    }
  })

  return found
}

export function renderMarkdown(source: string, options: RenderOptions = {}): string {
  const headings: Heading[] = []
  const marked =
    options.toc || options.code
      ? renderer(options, headings)
      : options.escapeHtml
        ? publishing
        : trusting

  const body = stripFrontMatter(source)
  let html = marked.parse(body, { async: false })

  html = markAbbreviations(html, collectAbbreviations(body))

  if (options.toc) html = html.replace(TOC_MARK, tableOfContents(headings))

  if (!options.footnotes) return html

  // Footnote definitions render as <li>; gather any trailing run into a list.
  return html.replace(
    /(?:<li id="fn-[\s\S]*?<\/li>\n?)+/g,
    (block) => `<section class="footnotes"><ol>${block}</ol></section>`,
  )
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
      heading.level > last ? depth + 1 : heading.level < last ? Math.max(0, heading.level - top) : depth

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
    return chunk.replace(word, (term) => `<abbr title="${escape(terms.get(term)!)}">${term}</abbr>`)
  }
}

export {
  abbreviations,
  callouts,
  definitionLists,
  emoji,
  footnotes,
  highlight,
  maths,
  scripts,
} from './extensions'
