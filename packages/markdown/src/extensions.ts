import katex from 'katex'
// Chemical equations: `\ce{H2O}` and friends, as Typora supports.
import 'katex/contrib/mhchem'
import type { MarkedExtension, Tokens } from 'marked'
import { get } from 'node-emoji'
import { escape, fragment } from './html'

/** Renders TeX, or shows the source when it will not parse. */
function math(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' })
  } catch {
    const escaped = tex.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
    return display ? `<pre class="math-error">${escaped}</pre>` : `<code>${escaped}</code>`
  }
}

/** `==marked==` */
export const highlight: MarkedExtension = {
  extensions: [
    {
      name: 'highlight',
      level: 'inline',
      start: (src: string) => src.indexOf('=='),
      tokenizer(src: string) {
        const match = /^==(?=\S)([\s\S]*?\S)==/.exec(src)
        if (!match?.[1]) return undefined

        return {
          type: 'highlight',
          raw: match[0],
          text: match[1],
          tokens: this.lexer.inlineTokens(match[1]),
        }
      },
      renderer(token: Tokens.Generic) {
        return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`
      },
    },
  ],
}

/** `H~2~O` and `X^2^`
 *
 *  Both tokenize what is between the marks and render it through the parser,
 *  the way `highlight` above does. Interpolating the source text straight into
 *  the tag was a way past the escaping a published note relies on - `~<img
 *  src=x onerror=...>~` is not a raw HTML token, so nothing else would have
 *  caught it - and it also meant that emphasis inside a subscript came out as
 *  its own asterisks. */
export const scripts: MarkedExtension = {
  extensions: [
    {
      name: 'subscript',
      level: 'inline',
      start: (src: string) => src.indexOf('~'),
      tokenizer(src: string) {
        const inner = /^~(?!~)([^~\s][^~]*)~/.exec(src)
        if (!inner?.[1]) return undefined
        return {
          type: 'subscript',
          raw: inner[0],
          text: inner[1],
          tokens: this.lexer.inlineTokens(inner[1]),
        }
      },
      renderer(token: Tokens.Generic) {
        return `<sub>${this.parser.parseInline(token.tokens ?? [])}</sub>`
      },
    },
    {
      name: 'superscript',
      level: 'inline',
      start: (src: string) => src.indexOf('^'),
      tokenizer(src: string) {
        const inner = /^\^([^^\s][^^]*)\^/.exec(src)
        if (!inner?.[1]) return undefined
        return {
          type: 'superscript',
          raw: inner[0],
          text: inner[1],
          tokens: this.lexer.inlineTokens(inner[1]),
        }
      },
      renderer(token: Tokens.Generic) {
        return `<sup>${this.parser.parseInline(token.tokens ?? [])}</sup>`
      },
    },
  ],
}

/** `$inline$` and a `$$` block on its own lines. */
export const maths: MarkedExtension = {
  extensions: [
    {
      name: 'blockMath',
      level: 'block',
      start: (src: string) => src.indexOf('$$'),
      tokenizer(src: string) {
        const match = /^\$\$\r?\n([\s\S]+?)\r?\n\$\$(?:\r?\n|$)/.exec(src)
        if (!match) return undefined
        return { type: 'blockMath', raw: match[0], text: match[1] }
      },
      renderer: (token: Tokens.Generic) =>
        `<div class="math-block">${math(token.text ?? '', true)}</div>`,
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: (src: string) => src.indexOf('$'),
      tokenizer(src: string) {
        const match = /^\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$/.exec(src)
        if (!match) return undefined
        return { type: 'inlineMath', raw: match[0], text: match[1] }
      },
      renderer: (token: Tokens.Generic) =>
        `<span class="math-inline">${math(token.text ?? '', false)}</span>`,
    },
  ],
}

const CALLOUT = /^\s*\[!(note|tip|important|warning|caution)\]\s*/i
const CALLOUT_TEXT = /\[!(?:note|tip|important|warning|caution)\]\s*(?:<br\s*\/?>)?\s*/i

/** GitHub-style alerts: a blockquote whose first line names a kind. */
export const callouts: MarkedExtension = {
  renderer: {
    blockquote(token: Tokens.Blockquote) {
      const first = token.tokens?.[0]
      const raw = first && 'text' in first ? String(first.text) : ''
      const match = CALLOUT.exec(raw)

      if (!match) return `<blockquote>\n${this.parser.parse(token.tokens ?? [])}</blockquote>\n`

      const kind = (match[1] ?? '').toLowerCase()
      const label = kind.charAt(0).toUpperCase() + kind.slice(1)

      // The marker becomes the heading, so drop it from the rendered body.
      const body = this.parser.parse(token.tokens ?? []).replace(CALLOUT_TEXT, '')

      return `<div class="callout" data-kind="${kind}"><p class="callout-label">${label}</p>\n${body}</div>\n`
    },
  },
}

/** `:smile:` becomes the character it names. */
export const emoji: MarkedExtension = {
  extensions: [
    {
      name: 'emoji',
      level: 'inline',
      start: (src: string) => src.indexOf(':'),
      tokenizer(src: string) {
        const match = /^:([a-z0-9_+-]+):/i.exec(src)
        if (!match?.[1]) return undefined

        const character = get(match[1])
        if (!character) return undefined

        return { type: 'emoji', raw: match[0], text: character }
      },
      renderer: (token: Tokens.Generic) => String(token.text),
    },
  ],
}

/** A term on one line, its meanings on the `:` lines under it:
 *
 *      Markdown
 *      : A way of writing formatted text.
 *      : Also the format itself.
 */
export const definitionLists: MarkedExtension = {
  extensions: [
    {
      name: 'definitionList',
      level: 'block',
      start: (src: string) => {
        const at = src.search(/\n[ \t]{0,3}:[ \t]+\S/)
        return at < 0 ? undefined : at
      },
      tokenizer(src: string) {
        const block = /^((?:[^\n:][^\n]*\n(?:[ \t]{0,3}:[ \t]+[^\n]*(?:\n|$))+)+)/.exec(src)?.[1]
        if (block === undefined) return undefined

        const items: { term: string; details: string[] }[] = []

        for (const line of block.split('\n')) {
          if (!line.trim()) continue

          const detail = /^[ \t]{0,3}:[ \t]+(.*)$/.exec(line)
          if (detail) items.at(-1)?.details.push(detail[1] ?? '')
          else items.push({ term: line.trim(), details: [] })
        }

        // A term with nothing under it is a paragraph, not a definition list.
        if (!items.length || items.some((item) => !item.details.length)) return undefined

        // Tokenized here: the lexer is only reachable from the tokenizer.
        return {
          type: 'definitionList',
          raw: block,
          items: items.map((item) => ({
            term: this.lexer.inlineTokens(item.term),
            details: item.details.map((detail) => this.lexer.inlineTokens(detail)),
          })),
        }
      },
      renderer(token: Tokens.Generic) {
        const items = token.items as { term: Tokens.Generic[]; details: Tokens.Generic[][] }[]

        const body = items
          .map((item) => {
            const term = `<dt>${this.parser.parseInline(item.term)}</dt>`
            const details = item.details
              .map((detail) => `<dd>${this.parser.parseInline(detail)}</dd>`)
              .join('\n')

            return `${term}\n${details}`
          })
          .join('\n')

        return `<dl>\n${body}\n</dl>\n`
      },
    },
  ],
}

/** `*[HTML]: HyperText Markup Language` defines it; every later mention of
 *  `HTML` in the document then carries the expansion. */
export const abbreviations: MarkedExtension = {
  extensions: [
    {
      name: 'abbrDef',
      level: 'block',
      start: (src: string) => {
        const at = src.search(/\*\[[^\]\n]+\]:/)
        return at < 0 ? undefined : at
      },
      tokenizer(src: string) {
        const match = /^\*\[([^\]\n]+)\]:[ \t]*(.*)(?:\r?\n|$)/.exec(src)
        if (!match) return undefined

        return {
          type: 'abbrDef',
          raw: match[0],
          term: match[1] ?? '',
          title: (match[2] ?? '').trim(),
        }
      },
      // The definition itself is not shown; it only teaches the document a word.
      renderer: () => '',
    },
  ],
}

const ABBREV_DEF = /^\*\[([^\]\n]+)\]:[ \t]*(.*)$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Collects the abbreviations a document defines, so the rendered HTML can be
 *  marked up afterwards - the definition may come after its first use.
 *
 *  Read line by line rather than with one pass of the whole source, so that
 *  fenced code can be stepped over. The block tokenizer above never sees a line
 *  inside a fence, and this has to agree with it: a note showing what a
 *  definition looks like would otherwise teach itself the word. */
export function collectAbbreviations(source: string): Map<string, string> {
  const found = new Map<string, string>()
  let fence: string | null = null

  for (const line of source.split('\n')) {
    const mark = FENCE.exec(line)?.[1]

    if (fence !== null) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null
      continue
    }
    if (mark) {
      fence = mark
      continue
    }

    const match = ABBREV_DEF.exec(line)
    if (!match) continue

    const term = match[1]?.trim()
    if (term) found.set(term, (match[2] ?? '').trim())
  }

  return found
}

/** `[^1]` in the text, `[^1]: …` at the bottom. */
export const footnotes: MarkedExtension = {
  extensions: [
    {
      name: 'footnoteDef',
      level: 'block',
      start: (src: string) => src.indexOf('[^'),
      tokenizer(src: string) {
        const match = /^\[\^([^\]\s]+)\]:\s*(.+)(?:\r?\n|$)/.exec(src)
        if (!match) return undefined

        return {
          type: 'footnoteDef',
          raw: match[0],
          id: match[1] ?? '',
          tokens: this.lexer.inlineTokens(match[2] ?? ''),
        }
      },
      renderer(token: Tokens.Generic) {
        const id = String(token.id)
        const key = fragment(id)
        const body = this.parser.parseInline(token.tokens ?? [])
        return `<li id="fn-${key}"><a class="footnote-back" href="#fnref-${key}">${escape(id)}</a> ${body}</li>\n`
      },
    },
    {
      name: 'footnoteRef',
      level: 'inline',
      start: (src: string) => src.indexOf('[^'),
      tokenizer(src: string) {
        const match = /^\[\^([^\]\s]+)\]/.exec(src)
        if (!match) return undefined
        return { type: 'footnoteRef', raw: match[0], id: match[1] }
      },
      renderer: (token: Tokens.Generic) => {
        const id = String(token.id)
        const key = fragment(id)
        return `<sup class="footnote-ref" id="fnref-${key}"><a href="#fn-${key}">${escape(id)}</a></sup>`
      },
    },
  ],
}
