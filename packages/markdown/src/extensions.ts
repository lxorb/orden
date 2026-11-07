import type { MarkedExtension, Token, Tokens } from 'marked'
import { blockMath, definitionList } from './blocks'
import { calloutChevron, calloutIcon, calloutOf, opensCallout } from './callouts'
import { emojiTable, loadEmoji, loadMaths, MOST_EMS, mathsEngine } from './engines'
import { CodeBlocks, WORDS } from './fences'
import { highlightTone, readHighlight } from './highlights'
import { escape, fragment } from './html'
import { firstStart, lineStart, matchesAt } from './starts'
import { remembering } from './tags'

const ESCAPED_IN_ERROR: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

function math(tex: string, display: boolean): string {
  const engine = mathsEngine()
  const escaped = () => tex.replace(/[&<>]/g, (c) => ESCAPED_IN_ERROR[c] ?? c)

  if (!engine) {
    void loadMaths()
    return display ? `<pre>${escaped()}</pre>` : `<code>${escaped()}</code>`
  }

  try {
    return engine.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      output: 'html',
      maxSize: MOST_EMS,
    })
  } catch {
    return display ? `<pre class="math-error">${escaped()}</pre>` : `<code>${escaped()}</code>`
  }
}

const CLOSERS = new WeakMap<Token[], number>()

function highlightEnd(src: string, tokens: Token[] | undefined): number {
  const left = tokens ? CLOSERS.get(tokens) : undefined
  if (left === -1) return -1
  if (left !== undefined && src.length - left >= 3) return src.length - left

  let at = src.indexOf('==', 3)
  while (at !== -1 && !/\S/.test(src.charAt(at - 1))) at = src.indexOf('==', at + 1)
  if (tokens) CLOSERS.set(tokens, at === -1 ? -1 : src.length - at)
  return at
}

export const highlight: MarkedExtension = remembering({
  extensions: [
    {
      name: 'highlight',
      level: 'inline',
      start: (src: string) => src.indexOf('=='),
      tokenizer(src: string, tokens: Token[]) {
        if (!src.startsWith('==') || !/\S/.test(src.charAt(2))) return undefined
        const end = highlightEnd(src, tokens)
        if (end === -1) return undefined

        const { colour, from } = readHighlight(src.slice(2, end))
        const words = src.slice(2 + from, end)

        return {
          type: 'highlight',
          raw: src.slice(0, end + 2),
          text: words,
          tone: colour.tone,
          tokens: this.lexer.inlineTokens(words),
        }
      },
      renderer(token: Tokens.Generic) {
        const drawn = highlightTone(typeof token.tone === 'number' ? token.tone : null).className
        const tone = drawn ? ` class="${drawn}"` : ''
        return `<mark${tone}>${this.parser.parseInline(token.tokens ?? [])}</mark>`
      },
    },
  ],
})

export const scripts: MarkedExtension = remembering({
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
})

function drawing(token: Tokens.Generic, display: boolean): string {
  const tex = String(token.text ?? '')
  const tag = display ? 'div' : 'span'
  const named = display ? 'math-block' : 'math-inline'

  return `<${tag} class="${named}" data-tex="${escape(tex)}">${math(tex, display)}</${tag}>`
}

export const maths: MarkedExtension = remembering({
  extensions: [
    {
      ...blockMath,
      renderer: (token: Tokens.Generic) => drawing(token, true),
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: (src: string) => src.indexOf('$'),
      tokenizer(src: string) {
        const match = /^\$(?!\s)((?:\\.|[^$\\])+?)(?<!\s)\$(?!\d)/.exec(src)
        if (!match) return undefined
        return { type: 'inlineMath', raw: match[0], text: match[1] }
      },
      renderer: (token: Tokens.Generic) => drawing(token, false),
    },
  ],
})

function afterMarker(tokens: Token[], cut: number): Token[] {
  const out: Token[] = []
  let left = cut

  for (const token of tokens) {
    if (left <= 0) {
      out.push(token)
      continue
    }

    const raw = token.raw
    if (raw.length <= left) {
      left -= raw.length
      continue
    }

    const kept = raw.slice(left)
    left = 0
    if (token.type === 'text') out.push({ ...token, raw: kept, text: kept })
  }

  return out
}

export const callouts: MarkedExtension = {
  renderer: {
    blockquote(token: Tokens.Blockquote) {
      const first = token.tokens[0]
      const opening = first && opensCallout(first) ? (first as Tokens.Paragraph) : null
      const found = opening ? calloutOf(opening.text) : null

      if (!opening || !found) {
        return `<blockquote>\n${this.parser.parse(token.tokens)}</blockquote>\n`
      }

      const inside = afterMarker(opening.tokens, found.taken)
      const rest: Token[] = inside.length
        ? [{ ...opening, text: found.rest, tokens: inside }, ...token.tokens.slice(1)]
        : token.tokens.slice(1)

      const look = found.look === null ? '' : ` callout-${found.look}`
      const title = escape(found.title || found.label)
      const box = found.foldable ? 'details' : 'div'
      const head = found.foldable ? 'summary' : 'p'
      const open = found.foldable && !found.folded ? ' open' : ''
      const chevron = found.foldable ? calloutChevron() : ''

      return (
        `<${box} class="callout${look}" data-callout="${escape(found.type)}"${open}>` +
        `<${head} class="callout-title">` +
        `${chevron}${calloutIcon(found.look)}<span>${title}</span></${head}>\n` +
        `<div class="callout-body">\n${this.parser.parse(rest)}</div></${box}>\n`
      )
    },
  },
}

export const emoji: MarkedExtension = remembering({
  extensions: [
    {
      name: 'emoji',
      level: 'inline',
      start: (src: string) => src.indexOf(':'),
      tokenizer(src: string) {
        const match = /^:([a-z0-9_+-]+):/i.exec(src)
        if (!match?.[1]) return undefined

        const table = emojiTable()
        if (!table) {
          void loadEmoji()
          return undefined
        }

        const character = table.get(match[1])
        if (!character) return undefined

        return { type: 'emoji', raw: match[0], text: character }
      },
      renderer: (token: Tokens.Generic) => String(token.text),
    },
  ],
})

export const definitionLists: MarkedExtension = {
  extensions: [
    {
      ...definitionList,
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

const DEFINITION = /\*\[[^\]\n]+\]:/y

function definition(src: string, at: number): number | null {
  const line = lineStart(src, at, { orString: true })
  return line !== null && matchesAt(DEFINITION, src, at) ? line : null
}

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
      renderer: () => '',
    },
  ],
}

const ABBREV_DEF = /^\*\[([^\]\n]+)\]:[ \t]*(.*)$/

export function collectAbbreviations(source: string): Map<string, string> {
  const found = new Map<string, string>()
  if (!source.includes('*[')) return found

  const code = new CodeBlocks()

  for (const line of source.split('\n')) {
    if (code.line(line) !== WORDS) continue

    const match = ABBREV_DEF.exec(line)
    if (!match) continue

    const term = match[1]?.trim()
    if (term) found.set(term, (match[2] ?? '').trim())
  }

  return found
}

const FOOTNOTE_DEF = /\[\^[^\]\s]+\]:\s*\S/y

function footnoteDefinition(src: string, at: number): number | null {
  const line = lineStart(src, at, { orString: true })
  return line !== null && matchesAt(FOOTNOTE_DEF, src, at) ? line : null
}

export const footnotes: MarkedExtension = remembering({
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
})
