/** The note as plain text: everything it says, none of the marks it says it
 *  with.
 *
 *  What survives is what a reader would still read out loud. A heading is its
 *  own line, a list keeps its bullets because the shape is the meaning, a link
 *  becomes `words (address)` because an address the reader cannot see is an
 *  address they have lost, a table is drawn with spaces so the columns still line
 *  up, and code is left exactly as it was written - a plain text file is where
 *  somebody goes to copy the code out. */

import type { Block, Doc, Item, Span } from './document'

/** Two spaces of indent per rung, which is what a bulleted list reads as
 *  everywhere text is plain. */
const STEP = '  '

const CHECKS = { true: '[x] ', false: '[ ] ' }

function spanText(span: Span): string {
  if (span.picture !== undefined) return span.text ? `[${span.text}]` : '[picture]'
  if (span.note !== undefined) return `[${span.note}]`

  // A link keeps its address, unless the words already are the address.
  if (span.href !== undefined && span.href !== span.text) return `${span.text} (${span.href})`

  return span.text
}

function textOf(spans: readonly Span[]): string {
  return spans.map(spanText).join('')
}

/** The width a column needs: the longest line any of its cells holds. */
function widths(rows: readonly string[][]): number[] {
  const out: number[] = []

  for (const row of rows) {
    row.forEach((cell, at) => {
      out[at] = Math.max(out[at] ?? 0, [...cell].length)
    })
  }

  return out
}

function tableLines(block: Extract<Block, { kind: 'table' }>): string[] {
  const head = block.head.map(textOf)
  const body = block.rows.map((row) => row.map(textOf))
  const columns = widths([head, ...body])

  const line = (cells: readonly string[]) =>
    cells
      .map((cell, at) =>
        block.align[at] === 'right'
          ? cell.padStart(columns[at] ?? 0)
          : cell.padEnd(columns[at] ?? 0),
      )
      .join('  ')
      .trimEnd()

  const rule = columns.map((width) => '-'.repeat(width)).join('  ')

  return [line(head), rule, ...body.map(line)]
}

function itemLines(item: Item, marker: string, indent: string): string[] {
  const check = item.checked === null ? '' : CHECKS[item.checked ? 'true' : 'false']
  const own = `${indent}${marker}${check}${textOf(item.spans)}`
  // What sits under an item is indented past its own marker, so a nested list
  // reads as nested rather than as a new list.
  const under = blockLines(item.blocks, indent + STEP)

  return under.length ? [own, ...under] : [own]
}

function blockLines(blocks: readonly Block[], indent = ''): string[] {
  const out: string[] = []

  for (const block of blocks) {
    if (out.length) out.push('')

    switch (block.kind) {
      case 'heading':
        out.push(`${indent}${textOf(block.spans)}`)
        break

      case 'paragraph':
        out.push(...wrapped(textOf(block.spans), indent))
        break

      case 'code':
        // As written, indent and all: this is what somebody came for.
        out.push(...block.code.split('\n').map((line) => `${indent}${line}`))
        break

      case 'maths':
        out.push(...block.tex.split('\n').map((line) => `${indent}${line}`))
        break

      case 'quote': {
        const body = blockLines(block.blocks)
        const lines = block.label ? [block.label, ...body] : body
        out.push(...lines.map((line) => `${indent}> ${line}`.trimEnd()))
        break
      }

      case 'list':
        block.items.forEach((item, at) => {
          const marker = block.ordered ? `${block.start + at}. ` : '- '
          out.push(...itemLines(item, marker, indent))
        })
        break

      case 'table':
        out.push(...tableLines(block).map((line) => `${indent}${line}`))
        break

      case 'terms':
        for (const entry of block.entries) {
          out.push(`${indent}${textOf(entry.term)}`)
          for (const detail of entry.details) out.push(`${indent}${STEP}${textOf(detail)}`)
        }
        break

      case 'rule':
        out.push(`${indent}${'-'.repeat(32)}`)
        break

      case 'break':
        // A page break has no meaning in a file with no pages; the blank line
        // above it is all it comes to.
        out.pop()
        break
    }
  }

  return out
}

/** A paragraph's own line breaks kept, nothing else wrapped: where the text
 *  ends up is the reader's window's business, not ours. */
function wrapped(text: string, indent: string): string[] {
  return text.split('\n').map((line) => `${indent}${line}`.trimEnd())
}

/** The document as one plain text file. The title heads it when the front matter
 *  named one the body does not already say, and the footnotes follow at the
 *  bottom, where they are in the note. */
export function toPlainText(doc: Doc): string {
  const lines: string[] = []
  const first = doc.blocks[0]
  const heads = first?.kind === 'heading' && textOf(first.spans).trim() === doc.title.trim()

  if (!heads && doc.title) lines.push(doc.title, '')
  lines.push(...blockLines(doc.blocks))

  if (doc.notes.length) {
    lines.push('', '-'.repeat(32), '')
    for (const note of doc.notes) lines.push(`[${note.label}] ${textOf(note.spans)}`)
  }

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`
}
