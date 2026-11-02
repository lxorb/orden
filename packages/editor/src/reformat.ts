import type { SyntaxNode, Tree } from '@lezer/common'
import type { StateCommand } from '@codemirror/state'
import { closesFence, fenceMark } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { nibMarkdownParser } from './markdown/extensions'
import { parseTable, serializeTable } from './table/model'

/** Which lines are code comes from @orden/markdown/fences, the same reading the
 *  renderer and the comment stripper use. The mark matters, not just the shape: a
 *  `~~~` in the middle of a ``` block is code, and reading it as a fence would
 *  end the block early and let the rest of it be rewritten as prose. */

/** What else is written to be read exactly, as the parser finds it: code, maths, raw
 *  HTML, a rule, and the spaces that end a line with a hard break. `* * *` is a rule
 *  rather than a list item, and two spaces at the end of a line are a line break, so
 *  `tidy` is kept away from the characters these are spelled with. */
const VERBATIM = new Set([
  'CodeBlock',
  // In a quote or a list item, where the walk below does not look.
  'FencedCode',
  'InlineCode',
  'BlockMath',
  'InlineMath',
  'HTMLBlock',
  'CommentBlock',
  'Comment',
  'HTMLTag',
  'HorizontalRule',
  'HardBreak',
  // Where a link points and what it is called: `[[a _b_ c]]` names a note with
  // underscores in it, and an asterisk there is a link to another note.
  'Wikilink',
  'URL',
  'LinkTitle',
  'LinkLabel',
  'LinkReference',
])

/** Tidies a document without changing what it means: dashes for stars, one emphasis
 *  style, pipe-aligned tables, and no runs of blank lines. */
export function reformat(source: string): string {
  const lines = source.split('\n')
  const out: string[] = []
  const tree = nibMarkdownParser.parse(source)
  const kept = verbatim(tree, lines)
  const tables = tableStarts(tree, lines)

  let index = 0
  let blanks = 0

  // YAML is not markdown, so front matter is copied through untouched. Its
  // values are full of the characters `tidy` rewrites - an `_id_` in a title,
  // a `* ` starting a list item - and rewriting them changes what the note
  // says about itself.
  const matter = readFrontMatter(source)
  if (matter) {
    out.push(...lines.slice(0, matter))
    index = matter
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const stretches = kept[index] ?? []

    const mark = fenceMark(line)
    if (mark) {
      // Code is copied through exactly as written, closing fence and all. A
      // block nothing closes runs to the end of the note, which is what the
      // parser does with it too.
      out.push(line)
      index += 1
      while (index < lines.length) {
        const inside = lines[index] ?? ''
        out.push(inside)
        index += 1
        if (closesFence(inside, mark)) break
      }
      blanks = 0
      continue
    }

    const table = tables.has(index) ? readTable(lines, index) : null
    if (table) {
      out.push(...table.text.split('\n'))
      index = table.next
      blanks = 0
      continue
    }

    if (!line.trim() && !stretches.length) {
      blanks += 1
      if (blanks <= 1) out.push('')
      index += 1
      continue
    }

    blanks = 0
    out.push(tidyAround(line, stretches))
    index += 1
  }

  // Exactly one trailing newline.
  while (out.length && !(out.at(-1) ?? '').trim()) out.pop()
  return `${out.join('\n')}\n`
}

/** How many lines the document's front matter takes, or null when it has none.
 *  The same test the parser makes (see `FrontMatter` in markdown/constructs.ts) so
 *  that the two agree on what a leading `---` is. */
function readFrontMatter(source: string): number | null {
  const block = frontMatterBlock(source)
  return block && source.slice(0, block.close).split('\n').length
}

/** The lines the parser starts a table on: not in code, a comment or HTML, and not
 *  in a quote or a list item, whose markers the serialiser would drop. */
function tableStarts(tree: Tree, lines: readonly string[]): Set<number> {
  const starts = new Set<number>()
  tree.iterate({
    enter(node) {
      if (node.name === 'Blockquote' || node.name === 'ListItem') return false
      if (node.name !== 'Table') return true
      starts.add(node.from)
      return false
    },
  })

  const found = new Set<number>()
  let start = 0
  for (const [index, line] of lines.entries()) {
    if (starts.has(start + line.length - line.trimStart().length)) found.add(index)
    start += line.length + 1
  }
  return found
}

/** A table starting at `start`, already re-aligned, or null. */
function readTable(lines: string[], start: number): { text: string; next: number } | null {
  if (!lines[start]?.includes('|')) return null

  let end = start
  while (end < lines.length) {
    const line = lines[end]
    if (!line?.includes('|') || !line.trim()) break
    end += 1
  }

  const block = lines.slice(start, end).join('\n')
  const model = parseTable(block)
  if (!model) return null

  return { text: serializeTable(model), next: end }
}

/** For each line, the stretches of it the parser says are `VERBATIM`, from and to
 *  within the line. A blank line inside one, in a comment or between two lines of
 *  code, has one that is empty. */
function verbatim(tree: Tree, lines: readonly string[]): [number, number][][] {
  const ranges: [number, number][] = []
  tree.iterate({
    enter(node) {
      if (node.name === 'BulletList') markersOfNeighbours(node.node, ranges)
      if (!VERBATIM.has(node.name)) return true
      ranges.push([node.from, node.to])
      return false
    },
  })

  let start = 0
  return lines.map((line) => {
    const end = start + line.length
    const within = ranges
      .filter(([from, to]) => from <= end && to > start)
      .map(([from, to]): [number, number] => [
        Math.max(from, start) - start,
        Math.min(to, end) - start,
      ])
    start = end + 1
    return within
  })
}

/** A list right beside another list is apart from it only by its marker: `- a` over
 *  `* b` is two lists, and the same marker on both would make it one. */
function markersOfNeighbours(list: SyntaxNode, ranges: [number, number][]) {
  if (list.prevSibling?.name !== 'BulletList' && list.nextSibling?.name !== 'BulletList') return

  for (let item = list.firstChild; item; item = item.nextSibling) {
    const mark = item.getChild('ListMark')
    if (mark) ranges.push([mark.from, mark.to])
  }
}

/** `tidy`, leaving the `kept` stretches of the line as they are. Every rewrite it
 *  makes keeps the line's length but the trimming of its end, so a kept character can
 *  be hidden behind an `x` - whitespace staying whitespace, so what is around it reads
 *  the same - and put back at the same place afterwards. */
function tidyAround(line: string, kept: readonly [number, number][]): string {
  const isKept = (at: number) => kept.some(([from, to]) => at >= from && at < to)
  const tidied = tidy(line.replace(/\S/g, (char, at: number) => (isKept(at) ? 'x' : char)))
  // What `tidy` trimmed off the end reads as nothing.
  return line.replace(/[^]/g, (char, at: number) => (isKept(at) ? char : tidied.charAt(at)))
}

function tidy(line: string): string {
  return (
    line
      // One bullet character throughout. Not over a `+`, which a deck reads as a list
      // that comes in one click at a time; see `fragmentsOf` in @orden/markdown/slides.
      .replace(/^(\s*)\*(\s+)/, '$1-$2')
      // Underscore emphasis becomes asterisk, which nests more predictably.
      .replace(/(^|[\s(])__(\S(?:[^_]*\S)?)__(?=[\s).,;:!?]|$)/g, '$1**$2**')
      .replace(/(^|[\s(])_(\S(?:[^_]*\S)?)_(?=[\s).,;:!?]|$)/g, '$1*$2*')
      // Setext-style trailing hashes on a heading add nothing.
      .replace(/^(#{1,6}\s+.*?)\s+#+\s*$/, '$1')
      .replace(/[ \t]+$/, '')
  )
}

/** Rewrites the whole document, keeping the caret where it was. */
export const reformatDocument: StateCommand = ({ state, dispatch }) => {
  const source = state.doc.toString()
  const tidied = reformat(source)
  if (tidied === source) return false

  const caret = Math.min(state.selection.main.head, tidied.length)
  dispatch(
    state.update({
      changes: { from: 0, to: state.doc.length, insert: tidied },
      selection: { anchor: caret },
    }),
  )
  return true
}
