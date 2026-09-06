import type { StateCommand } from '@codemirror/state'
import { parseTable, serializeTable } from './table/model'

/** A fence line: up to three spaces of indent, then three or more backticks or
 *  tildes. The mark matters, not just the shape: a `~~~` in the middle of a
 *  ``` block is code, and reading it as a fence would end the block early and
 *  let the rest of it be rewritten as prose. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/

function fenceMark(line: string): string | null {
  return FENCE.exec(line)?.[1] ?? null
}

/** Whether a line closes a fence opened with `mark`: the same character, at
 *  least as many of them, and nothing else on the line. */
function closesFence(line: string, mark: string): boolean {
  const found = fenceMark(line)
  if (!found || found[0] !== mark[0] || found.length < mark.length) return false
  return !line.slice(line.indexOf(found) + found.length).trim()
}

/** Tidies a document without changing what it means: one bullet character, one
 *  emphasis style, pipe-aligned tables, and no runs of blank lines. */
export function reformat(source: string): string {
  const lines = source.split('\n')
  const out: string[] = []

  let index = 0
  let blanks = 0

  // YAML is not markdown, so front matter is copied through untouched. Its
  // values are full of the characters `tidy` rewrites - an `_id_` in a title,
  // a `* ` starting a list item - and rewriting them changes what the note
  // says about itself.
  const matter = readFrontMatter(lines)
  if (matter) {
    out.push(...lines.slice(0, matter))
    index = matter
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''

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

    const table = readTable(lines, index)
    if (table) {
      out.push(...table.text.split('\n'))
      index = table.next
      blanks = 0
      continue
    }

    if (!line.trim()) {
      blanks += 1
      if (blanks <= 1) out.push('')
      index += 1
      continue
    }

    blanks = 0
    out.push(tidy(line))
    index += 1
  }

  // Exactly one trailing newline.
  while (out.length && !(out.at(-1) ?? '').trim()) out.pop()
  return `${out.join('\n')}\n`
}

/** How many lines the document's front matter takes, or null when it has none.
 *  Only at the very top, and only when what follows looks like YAML, which is
 *  the same test the parser makes (see `FrontMatter` in markdown/extensions.ts)
 *  so that the two agree on what a leading `---` is. */
function readFrontMatter(lines: readonly string[]): number | null {
  if (lines[0]?.trim() !== '---') return null
  if (!/^\s*[\w.$-]+\s*:/.test(lines[1] ?? '')) return null

  for (let index = 1; index < lines.length; index++) {
    if (lines[index]?.trim() === '---') return index + 1
  }
  // Unclosed, and the parser would not call it front matter either.
  return null
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

function tidy(line: string): string {
  return (
    line
      // One bullet character throughout.
      .replace(/^(\s*)[*+](\s+)/, '$1-$2')
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
