import type { Change } from './apply'
import { lineAt, lineStarts } from '@orden/scan/search/lines'
import type { Span } from '@orden/scan/search/match'

export interface Edit {
  from: number
  to: number
  insert: string
}

export function expand(
  replacement: string,
  matched: string,
  groups: readonly string[] | undefined,
): string {
  if (!groups) return replacement

  return replacement.replace(/\$(\$|&|\d)/g, (whole, what: string) => {
    if (what === '$') return '$'
    if (what === '&') return matched

    return groups[Number(what) - 1] ?? whole
  })
}

export function replaceIn(
  body: string,
  spans: readonly Span[],
  lines: ReadonlySet<number>,
  replacement: string,
): Edit[] | null {
  const starts = lineStarts(body)
  const wanted = spans
    .filter((span) => span.from < span.to && lines.has(lineAt(starts, span.from)))
    .sort((a, b) => a.from - b.from || b.to - a.to)

  const edits: Edit[] = []
  let reached = 0

  for (const span of wanted) {
    if (span.from < reached) continue

    edits.push({
      from: span.from,
      to: span.to,
      insert: expand(replacement, body.slice(span.from, span.to), span.groups),
    })
    reached = span.to
  }

  return edits.length ? edits : null
}

export function applied(body: string, edits: readonly Edit[]): string {
  let text = ''
  let at = 0
  for (const edit of edits) {
    text += body.slice(at, edit.from) + edit.insert
    at = edit.to
  }

  return text + body.slice(at)
}

export function changeOf(path: string, before: string, edits: Edit[]): Change {
  return { path, before, after: applied(before, edits), edits, back: reverse(before, edits) }
}

export function endingsLike(words: string, like: string): string {
  return like.includes('\r') || !words.includes('\r') ? words : words.replace(/\r\n?/g, '\n')
}

export function flatEdits(words: string, edits: readonly Edit[]): { words: string; edits: Edit[] } {
  if (!words.includes('\r')) return { words, edits: edits.map((one) => ({ ...one })) }

  const dropped: number[] = new Array<number>(words.length + 1)
  let count = 0
  for (let at = 0; at <= words.length; at++) {
    dropped[at] = count
    if (words[at] === '\r' && words[at + 1] === '\n') count++
  }
  const flat = (at: number) => at - (dropped[Math.max(0, Math.min(at, words.length))] ?? 0)

  return {
    words: words.replace(/\r\n?/g, '\n'),
    edits: edits.map((one) => ({
      from: flat(one.from),
      to: flat(one.to),
      insert: one.insert.replace(/\r\n?/g, '\n'),
    })),
  }
}

function crlfFirst(file: string): boolean {
  const first = file.indexOf('\n')
  return first > 0 && file[first - 1] === '\r'
}

export function appliedToFile(file: string, edits: readonly Edit[]): string {
  const crlf = crlfFirst(file)
  let raw = 0
  let flat = 0
  const seek = (to: number) => {
    for (; flat < to; flat++) raw += file[raw] === '\r' && file[raw + 1] === '\n' ? 2 : 1
    return raw
  }

  let out = ''
  let last = 0
  for (const edit of edits) {
    out += file.slice(last, seek(edit.from))
    out += crlf ? edit.insert.replace(/\r?\n/g, '\r\n') : edit.insert
    last = seek(edit.to)
  }
  return out + file.slice(last)
}

export function reverse(body: string, edits: readonly Edit[]): Edit[] {
  let drift = 0

  return edits.map((edit) => {
    const from = edit.from + drift
    const to = from + edit.insert.length
    drift += edit.insert.length - (edit.to - edit.from)

    return { from, to, insert: body.slice(edit.from, edit.to) }
  })
}
