import { CODE, CodeBlocks, closingTicks, OPENS } from './fences'
import { frontMatterBlock } from './front-matter'

const COMMENTS = [
  { open: '<!--', close: '-->' },
  { open: '%%', close: '%%' },
] as const

function opening(line: string, at: number): { from: number; to: number; close: string } | null {
  let found: { from: number; to: number; close: string } | null = null

  for (const comment of COMMENTS) {
    const from = line.indexOf(comment.open, at)
    if (from === -1 || (found && from >= found.from)) continue
    found = { from, to: from + comment.open.length, close: comment.close }
  }

  return found
}

export function stripLine(
  line: string,
  inside: string | null,
): { text: string; inside: string | null } {
  let out = ''
  let at = 0
  let open = inside

  while (at < line.length) {
    if (open) {
      const end = line.indexOf(open, at)
      if (end === -1) return { text: out, inside: open }
      at = end + open.length
      open = null
      continue
    }

    if (line[at] === '\\') {
      out += line.slice(at, at + 2)
      at += 2
      continue
    }

    if (line[at] === '`') {
      const marks = /^`+/.exec(line.slice(at))?.[0] ?? '`'
      const close = closingTicks(line, at + marks.length, marks.length)
      const span = close === -1 ? marks.length : close + marks.length - at
      out += line.slice(at, at + span)
      at += span
      continue
    }

    const found = opening(line, at)
    if (!found) {
      out += line.slice(at)
      break
    }

    const next = line.slice(at, found.from).search(/[\\`]/)
    if (next !== -1) {
      out += line.slice(at, at + next)
      at += next
      continue
    }

    out += line.slice(at, found.from)
    at = found.to
    open = found.close
  }

  return { text: out, inside: open }
}

const QUOTE_LEAD = /^(?:[ \t]*>)+/

function keptInQuote(line: string, text: string, quoted: string): string {
  if (!quoted || text.startsWith(quoted)) return text
  const lead = QUOTE_LEAD.exec(line)?.[0] ?? ''
  return lead.replace(/[ \t]/g, '') === quoted.replace(/[ \t]/g, '') ? lead + text : text
}

export function withoutComments(source: string): string {
  if (!COMMENTS.some((one) => source.includes(one.open))) return source
  return strippedLines(source).join('\n')
}

export class CommentLines {
  private code = new CodeBlocks()
  private quoted = ''
  inside: string | null = null

  copy(): CommentLines {
    const twin = new CommentLines()
    twin.code = this.code.copy()
    twin.quoted = this.quoted
    twin.inside = this.inside
    return twin
  }

  line(line: string): string {
    if (this.inside) {
      const stripped = stripLine(line, this.inside)
      this.inside = stripped.inside
      const text = keptInQuote(line, stripped.text, this.quoted)
      this.code.line(text)
      return text
    }

    const before = this.code.copy()
    const kind = this.code.line(line)
    if (kind === CODE) return line

    if (kind === OPENS) {
      const mark = this.code.fence ?? ''
      const opens = line.indexOf(mark) + mark.length
      return line.slice(0, opens) + stripLine(line.slice(opens), null).text
    }

    const stripped = stripLine(line, null)
    this.inside = stripped.inside
    if (this.inside) this.quoted = QUOTE_LEAD.exec(line)?.[0] ?? ''

    if (stripped.text !== line) {
      this.code = before
      this.code.line(stripped.text)
    }
    return stripped.text
  }
}

function strippedLines(source: string): string[] {
  const reader = new CommentLines()
  return source.split('\n').map((line) => reader.line(line))
}

export function noteWithoutComments(source: string): string {
  const block = frontMatterBlock(source)
  if (!block) return withoutComments(source)
  return (
    source.slice(0, block.body.from) +
    valuesWithoutComments(source.slice(block.body.from, block.body.to)) +
    source.slice(block.body.to, block.to) +
    withoutComments(source.slice(block.to))
  )
}

function valuesWithoutComments(body: string): string {
  if (!COMMENTS.some((one) => body.includes(one.open))) return body

  const lines = body.split('\n')
  const out: string[] = []
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? ''
    const { text, inside } = stripLine(line, null)
    if (inside === null) {
      out.push(text)
      continue
    }

    const closes =
      text.trim() === '' ? lines.findIndex((one, below) => below > at && one.includes(inside)) : -1
    if (closes === -1) {
      out.push(line)
      continue
    }
    out.push(
      text,
      ...lines.slice(at + 1, closes).map(() => ''),
      stripLine(lines[closes] ?? '', inside).text,
    )
    at = closes
  }
  return out.join('\n')
}
