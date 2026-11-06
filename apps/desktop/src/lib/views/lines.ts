import { placeIn } from '@orden/bases/agent'
import { taskLine } from '../rows/write'

interface Anchor {
  line: number
  hash: string
}

interface Line {
  text: string
  from: number
}

function linesOf(text: string): Line[] {
  const out: Line[] = []
  let from = 0
  for (const one of text.split('\n')) {
    out.push({ text: one, from })
    from += one.length + 1
  }
  return out
}

const indentOf = (text: string) => /^[ \t]*/.exec(text)?.[0].replace(/\t/g, '    ').length ?? 0

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

export function lineOfAnchor(text: string, anchor: Anchor): number | null {
  const span = taskLine(text, anchor)
  if (span === null) return null
  let line = 0
  for (let at = text.indexOf('\n'); at !== -1 && at < span.from; at = text.indexOf('\n', at + 1)) {
    line++
  }
  return line
}

function blockAt(lines: readonly { text: string }[], index: number): [number, number] {
  const own = indentOf(lines[index]?.text ?? '')
  let end = index + 1
  while (end < lines.length) {
    const text = lines[end]?.text ?? ''
    if (text.trim() === '') {
      const next = lines.slice(end + 1).find((one) => one.text.trim() !== '')
      if (!next || indentOf(next.text) <= own) break
    } else if (indentOf(text) <= own) break
    end++
  }
  return [index, end]
}

function spliced(lines: readonly Line[], from: number, to: number, insert: string[]): string {
  const texts = lines.map((one) => one.text)
  texts.splice(from, to - from, ...insert)
  return texts.join('\n')
}

function siblingBlock(lines: readonly Line[], index: number, up: boolean): [number, number] | null {
  const own = indentOf(lines[index]?.text ?? '')
  if (up) {
    for (let at = index - 1; at >= 0; at--) {
      const text = lines[at]?.text ?? ''
      if (text.trim() === '') continue
      const depth = indentOf(text)
      if (depth < own || HEADING.test(text)) return null
      if (depth === own) return blockAt(lines, at)
    }
    return null
  }
  const [, end] = blockAt(lines, index)
  const next = lines[end]
  if (!next || indentOf(next.text) !== own || next.text.trim() === '' || HEADING.test(next.text)) {
    return null
  }
  return blockAt(lines, end)
}

export function movedBlock(text: string, anchor: Anchor, up: boolean): string | null {
  const index = lineOfAnchor(text, anchor)
  if (index === null) return null
  const lines = linesOf(text)
  const own = blockAt(lines, index)
  const other = siblingBlock(lines, index, up)
  if (!other) return null

  const take = (span: [number, number]) => lines.slice(span[0], span[1]).map((one) => one.text)
  const [first, second] = up ? [other, own] : [own, other]
  return spliced(lines, first[0], second[1], [...take(second), ...take(first)])
}

export function indentedBlock(text: string, anchor: Anchor, deeper: boolean): string | null {
  const index = lineOfAnchor(text, anchor)
  if (index === null) return null
  const lines = linesOf(text)
  const [from, to] = blockAt(lines, index)
  const own = indentOf(lines[index]?.text ?? '')

  if (deeper && !siblingBlock(lines, index, true)) return null
  if (!deeper && own === 0) return null

  const step = (lines[index]?.text ?? '').startsWith('\t') ? '\t' : '  '
  const moved = lines.slice(from, to).map((one) => {
    if (one.text.trim() === '') return one.text
    if (deeper) return step + one.text
    return one.text.replace(/^(\t| {1,4})/, '')
  })
  return spliced(lines, from, to, moved)
}

export function withLines(text: string, block: readonly string[], heading?: string): string {
  const { at, insert } = placeIn(text, block, heading)
  return text.slice(0, at) + insert + text.slice(at)
}

export function cutBlock(text: string, anchor: Anchor): { rest: string; block: string[] } | null {
  const index = lineOfAnchor(text, anchor)
  if (index === null) return null
  const lines = linesOf(text)
  const [from, to] = blockAt(lines, index)
  const own = /^[ \t]*/.exec(lines[index]?.text ?? '')?.[0] ?? ''
  const block = lines
    .slice(from, to)
    .map((one) => (one.text.startsWith(own) ? one.text.slice(own.length) : one.text.trimStart()))
  return { rest: spliced(lines, from, to, []), block }
}

export function movedBeside(
  text: string,
  anchor: Anchor,
  target: Anchor,
  after: boolean,
): string | null {
  const cut = cutBlock(text, anchor)
  if (!cut) return null
  const index = lineOfAnchor(cut.rest, target)
  if (index === null) return null
  const lines = linesOf(cut.rest)
  const at = after ? blockAt(lines, index)[1] : index
  const indent = /^[ \t]*/.exec(lines[index]?.text ?? '')?.[0] ?? ''
  return spliced(
    lines,
    at,
    at,
    cut.block.map((one) => (one.trim() === '' ? one : indent + one)),
  )
}

export function movedUnder(text: string, anchor: Anchor, heading: string): string | null {
  const cut = cutBlock(text, anchor)
  if (!cut) return null
  return withLines(cut.rest, cut.block, heading)
}

export function withoutBlock(text: string, anchor: Anchor): string | null {
  return cutBlock(text, anchor)?.rest ?? null
}

export function duplicatedBlock(text: string, anchor: Anchor): string | null {
  const index = lineOfAnchor(text, anchor)
  if (index === null) return null
  const lines = linesOf(text)
  const [from, to] = blockAt(lines, index)
  const copy = lines.slice(from, to).map((one) => one.text.replace(/\s\^[\w-]+\s*$/, ''))
  return spliced(lines, to, to, copy)
}

export function outermost<T extends { anchor: Anchor }>(text: string, many: readonly T[]): T[] {
  const lines = linesOf(text)
  const placed = many.flatMap((one) => {
    const index = lineOfAnchor(text, one.anchor)
    return index === null ? [] : [{ one, span: blockAt(lines, index) }]
  })
  return placed
    .filter(
      ({ span }) => !placed.some((other) => other.span[0] < span[0] && span[1] <= other.span[1]),
    )
    .sort((a, b) => b.span[0] - a.span[0])
    .map(({ one }) => one)
}

export function editedLines(
  text: string,
  anchors: readonly Anchor[],
  edit: (line: string) => readonly { from: number; to: number; insert: string }[],
): string {
  let out = text
  for (const anchor of [...anchors].sort((a, b) => b.line - a.line)) {
    const index = lineOfAnchor(out, anchor)
    if (index === null) continue
    const line = linesOf(out)[index]
    if (!line) continue
    const own = line.text.replace(/\r$/, '')
    const edits = [...edit(own)].sort((a, b) => b.from - a.from)
    for (const one of edits) {
      out = out.slice(0, line.from + one.from) + one.insert + out.slice(line.from + one.to)
    }
  }
  return out
}
