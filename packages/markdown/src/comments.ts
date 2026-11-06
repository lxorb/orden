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

function stripLine(line: string, inside: string | null): { text: string; inside: string | null } {
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

export function withoutComments(source: string): string {
  if (!COMMENTS.some((one) => source.includes(one.open))) return source

  const lines = source.split('\n')
  const out: string[] = []
  let code = new CodeBlocks()
  let inside: string | null = null

  for (const line of lines) {
    if (inside) {
      const stripped = stripLine(line, inside)
      inside = stripped.inside
      out.push(stripped.text)
      code.line(stripped.text)
      continue
    }

    const before = code.copy()
    const kind = code.line(line)
    if (kind === CODE) {
      out.push(line)
      continue
    }

    if (kind === OPENS) {
      const mark = code.fence ?? ''
      const opens = line.indexOf(mark) + mark.length
      out.push(line.slice(0, opens) + stripLine(line.slice(opens), null).text)
      continue
    }

    const stripped = stripLine(line, inside)
    inside = stripped.inside
    out.push(stripped.text)

    if (stripped.text !== line) {
      code = before
      code.line(stripped.text)
    }
  }

  return out.join('\n')
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
