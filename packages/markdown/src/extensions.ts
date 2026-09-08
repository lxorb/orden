import katex from 'katex'
// Chemical equations: `\ce{H2O}` and friends, as Typora supports.
import 'katex/contrib/mhchem'
import type { MarkedExtension, Tokens } from 'marked'
import { get } from 'node-emoji'
import { escape, fragment } from './html'
import { firstStart, lineStart, matchesAt } from './starts'

/** Only the three that matter in element content, which is where the source of
 *  an equation that would not parse ends up. */
const ESCAPED_IN_ERROR: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

/** The largest a formula may say one of its own parts is, in ems.
 *
 *  TeX lets the formula choose: `\rule`, `\kern`, `\raisebox` and their
 *  neighbours all take a length, and KaTeX honours whatever they ask for unless
 *  it is told a ceiling. A note is not always the reader's own - one arrives
 *  from a share, from a room, or is published to strangers from a domain shared
 *  with every other blog - so a single line of TeX could hand the reader a box
 *  tens of thousands of ems tall, which is a page nobody can read or scroll.
 *  Well past anything a real equation asks for; nothing legible is 100 lines
 *  tall. Macro depth needs no number here: KaTeX caps expansion by default. */
export const MOST_EMS = 100

/** Renders TeX, or shows the source when it will not parse. */
function math(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      output: 'html',
      maxSize: MOST_EMS,
    })
  } catch {
    const escaped = tex.replace(/[&<>]/g, (c) => ESCAPED_IN_ERROR[c] ?? c)
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

/** A `$$` that opens a block. Two shapes, and both of them take a whole line:
 *  `$$` on a line of its own with a closing one under it, or a single line that
 *  is nothing but `$$…$$`, which is how the formula is usually typed and how
 *  every other editor reads it.
 *
 *  Confirmed rather than assumed, and a whole line rather than anywhere on one,
 *  because `$$` in the middle of a sentence would otherwise cut the paragraph in
 *  two there: "Costs $$5 and $$6 in total" is prose about money. */
const MATH_BLOCK = /\$\$(?:\r?\n[\s\S]+?\r?\n|(?![\s$])[^\n]*?(?<![\s$]))\$\$[ \t]*(?:\r?\n|$)/y

function mathBlock(src: string, at: number): number | null {
  const line = lineStart(src, at, { orString: true })
  return line !== null && matchesAt(MATH_BLOCK, src, at) ? line : null
}

/** `$inline$`, and a `$$` block written either way. */
export const maths: MarkedExtension = {
  extensions: [
    {
      name: 'blockMath',
      level: 'block',
      start: (src: string) => firstStart(src, ['$$'], mathBlock),
      tokenizer(src: string) {
        const match =
          /^\$\$(?:\r?\n([\s\S]+?)\r?\n|(?![\s$])([^\n]*?)(?<![\s$]))\$\$[ \t]*(?:\r?\n|$)/.exec(
            src,
          )
        if (!match) return undefined

        // Whichever of the two shapes matched is the one that captured.
        return { type: 'blockMath', raw: match[0], text: match[1] ?? match[2] }
      },
      renderer: (token: Tokens.Generic) =>
        `<div class="math-block">${math(String(token.text ?? ''), true)}</div>`,
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
        `<span class="math-inline">${math(String(token.text ?? ''), false)}</span>`,
    },
  ],
}

const CALLOUT = /^\s*\[!(note|tip|important|warning|caution)\]\s*/i
const CALLOUT_TEXT = /\[!(?:note|tip|important|warning|caution)\]\s*(?:<br\s*\/?>)?\s*/i

/** GitHub-style alerts: a blockquote whose first line names a kind. */
export const callouts: MarkedExtension = {
  renderer: {
    blockquote(token: Tokens.Blockquote) {
      const first = token.tokens[0]
      const raw = first && 'text' in first ? String(first.text) : ''
      const match = CALLOUT.exec(raw)

      if (!match) return `<blockquote>\n${this.parser.parse(token.tokens)}</blockquote>\n`

      const kind = (match[1] ?? '').toLowerCase()
      const label = kind.charAt(0).toUpperCase() + kind.slice(1)

      // The marker becomes the heading, so drop it from the rendered body.
      const body = this.parser.parse(token.tokens).replace(CALLOUT_TEXT, '')

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
      // No `start`. A list needs its term line, and a paragraph that has already
      // swallowed the term line is not one this can rescue: cutting the paragraph
      // short leaves the tokenizer looking at the `:` line alone, which is not a
      // definition list either way. So the only place one is ever recognised is
      // where a block begins, which is where the tokenizer runs regardless.
      // Asking for the earliest colon in the rest of the document instead was
      // more than half the cost of rendering a large note.
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

/** An abbreviation being defined, wherever the `*[` the caller found sits. */
const DEFINITION = /\*\[[^\]\n]+\]:/y

function definition(src: string, at: number): number | null {
  return matchesAt(DEFINITION, src, at) ? at : null
}

/** `*[HTML]: HyperText Markup Language` defines it; every later mention of
 *  `HTML` in the document then carries the expansion. */
export const abbreviations: MarkedExtension = {
  extensions: [
    {
      name: 'abbrDef',
      level: 'block',
      start: (src: string) => firstStart(src, ['*['], definition),
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
      if (mark?.startsWith(fence.charAt(0)) && mark.length >= fence.length) fence = null
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

/** A footnote being defined rather than referred to: the colon is the whole
 *  difference. Confirmed for the same reason the maths block is - a `[^1]` in the
 *  middle of a sentence used to cut the paragraph in two just before it, which
 *  left a space in front of every footnote mark in the document. */
const FOOTNOTE_DEF = /\[\^[^\]\s]+\]:\s*\S/y

function footnoteDefinition(src: string, at: number): number | null {
  const line = lineStart(src, at, { orString: true })
  return line !== null && matchesAt(FOOTNOTE_DEF, src, at) ? line : null
}

/** `[^1]` in the text, `[^1]: …` at the bottom. */
export const footnotes: MarkedExtension = {
  extensions: [
    {
      name: 'footnoteDef',
      level: 'block',
      start: (src: string) => firstStart(src, ['[^'], footnoteDefinition),
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
