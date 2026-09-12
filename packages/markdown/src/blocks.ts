/** The two constructs this package adds that span more than the line they open
 *  on, as tokenizers with no renderer attached.
 *
 *  Apart from their renderers because two readers want them and only one of the two
 *  draws anything. The renderer of a `$$` block is KaTeX and its chemistry pack,
 *  which is most of this package's weight; a reader that only asks about the shape
 *  of a note - which list items a slide renders, in slides.ts - has to agree with
 *  the renderer about where each block begins and ends, and has no business
 *  loading a formula engine to find out.
 *
 *  Only these two, because only these two can move a block boundary past a line
 *  that would otherwise be a list item: everything else the package adds is inline,
 *  or is one line of its own (`*[ABBR]:`, `[^1]:`), and so leaves the lists around
 *  it exactly where they were. Whatever is added here has to keep that true. */

import type { TokenizerExtension } from 'marked'
import { firstStart, lineStart, matchesAt } from './starts'

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

export const blockMath: TokenizerExtension = {
  name: 'blockMath',
  level: 'block',
  start: (src: string) => firstStart(src, ['$$'], mathBlock),
  tokenizer(src: string) {
    const match =
      /^\$\$(?:\r?\n([\s\S]+?)\r?\n|(?![\s$])([^\n]*?)(?<![\s$]))\$\$[ \t]*(?:\r?\n|$)/.exec(src)
    if (!match) return undefined

    // Whichever of the two shapes matched is the one that captured.
    return { type: 'blockMath', raw: match[0], text: match[1] ?? match[2] }
  },
}

/** A term on one line, its meanings on the `:` lines under it:
 *
 *      Markdown
 *      : A way of writing formatted text.
 *      : Also the format itself.
 */
export const definitionList: TokenizerExtension = {
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
}
