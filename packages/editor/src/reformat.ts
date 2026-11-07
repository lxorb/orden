import type { SyntaxNode, Tree } from '@lezer/common'
import type { StateCommand } from '@codemirror/state'
import { closesFence, fenceMark } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { ordenMarkdownParser } from './markdown/extensions'
import { parseTable, serializeTable } from './table/model'

const VERBATIM = new Set([
  'CodeBlock',
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
  'Wikilink',
  'URL',
  'LinkTitle',
  'LinkLabel',
  'LinkReference',
])

export function reformat(source: string): string {
  const lines = source.split('\n')
  const out: string[] = []
  const tree = ordenMarkdownParser.parse(source)
  const kept = verbatim(tree, lines)
  const tables = tableStarts(tree, lines)

  let index = 0
  let blanks = 0

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

  while (out.length && !(out.at(-1) ?? '').trim()) out.pop()
  return `${out.join('\n')}\n`
}

function readFrontMatter(source: string): number | null {
  const block = frontMatterBlock(source)
  return block && source.slice(0, block.close).split('\n').length
}

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

function markersOfNeighbours(list: SyntaxNode, ranges: [number, number][]) {
  if (list.prevSibling?.name !== 'BulletList' && list.nextSibling?.name !== 'BulletList') return

  for (let item = list.firstChild; item; item = item.nextSibling) {
    const mark = item.getChild('ListMark')
    if (mark) ranges.push([mark.from, mark.to])
  }
}

function tidyAround(line: string, kept: readonly [number, number][]): string {
  const isKept = (at: number) => kept.some(([from, to]) => at >= from && at < to)
  const tidied = tidy(line.replace(/\S/g, (char, at: number) => (isKept(at) ? 'x' : char)))
  return line.replace(/[^]/g, (char, at: number) => (isKept(at) ? char : tidied.charAt(at)))
}

function tidy(line: string): string {
  return line
    .replace(/^(\s*)\*(\s+)/, '$1-$2')
    .replace(/(^|[\s(])__(\S(?:[^_]*\S)?)__(?=[\s).,;:!?]|$)/g, '$1**$2**')
    .replace(/(^|[\s(])_(\S(?:[^_]*\S)?)_(?=[\s).,;:!?]|$)/g, '$1*$2*')
    .replace(/^(#{1,6}\s+.*?)\s+#+\s*$/, '$1')
    .replace(/[ \t]+$/, '')
}

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
