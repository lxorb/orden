import type { Block, Doc, Item, Span } from './document'

const STEP = '  '

const CHECKS = { true: '[x] ', false: '[ ] ' }

function spanText(span: Span): string {
  if (span.picture !== undefined) return span.text ? `[${span.text}]` : '[picture]'
  if (span.note !== undefined) return `[${span.note}]`

  if (span.href !== undefined && span.href !== span.text) return `${span.text} (${span.href})`

  return span.text
}

function textOf(spans: readonly Span[]): string {
  return spans.map(spanText).join('')
}

const GRAPHEMES = new Intl.Segmenter()

function shownWidth(text: string): number {
  return [...GRAPHEMES.segment(text)].length
}

function widths(rows: readonly string[][]): number[] {
  const out: number[] = []

  for (const row of rows) {
    row.forEach((cell, at) => {
      out[at] = Math.max(out[at] ?? 0, shownWidth(cell))
    })
  }

  return out
}

function tableLines(block: Extract<Block, { kind: 'table' }>): string[] {
  const head = block.head.map(textOf)
  const body = block.rows.map((row) => row.map(textOf))
  const columns = widths([head, ...body])

  const padded = (cell: string, width: number, right: boolean) => {
    const gap = ' '.repeat(Math.max(0, width - shownWidth(cell)))
    return right ? gap + cell : cell + gap
  }

  const line = (cells: readonly string[]) =>
    cells
      .map((cell, at) => padded(cell, columns[at] ?? 0, block.align[at] === 'right'))
      .join('  ')
      .trimEnd()

  const rule = columns.map((width) => '-'.repeat(width)).join('  ')

  return [line(head), rule, ...body.map(line)]
}

function itemLines(item: Item, marker: string, indent: string): string[] {
  const check = item.checked === null ? '' : CHECKS[item.checked ? 'true' : 'false']
  const own = `${indent}${marker}${check}${textOf(item.spans)}`
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
        out.pop()
        break
    }
  }

  return out
}

function wrapped(text: string, indent: string): string[] {
  return text.split('\n').map((line) => `${indent}${line}`.trimEnd())
}

export function toPlainText(doc: Doc): string {
  const lines: string[] = []
  const first = doc.blocks[0]
  const heads = first?.kind === 'heading' && textOf(first.spans).trim() === doc.title.trim()

  if (doc.named && !heads) lines.push(doc.title, '')
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
