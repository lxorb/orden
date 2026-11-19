import { EditorSelection, type EditorState, type SelectionRange, type TransactionSpec } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { enclosingNamed } from './nodes'
import { everywhere, type Landing, plainAt, withLineFeeds } from './paste'

const CONTAINERS = /^(?:[ \t]*(?:>[ \t]?|(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?))*[ \t]*/
const ITEM_MARKS = /((?:[-*+]|\d+[.)])[ \t]+)(?:\[[ xX]\][ \t]+)?/g
const LEAD = /^([ \t]*(?:>[ \t]?)*[ \t]*)((?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/
const AN_ITEM = /^(?:[-*+]|\d+[.)])[ \t]/
const INNERMOST = /(?:>[ \t]?|([-*+])[ \t]+(?:\[[ xX]\][ \t]+)?|\d+([.)])[ \t]+(?:\[[ xX]\][ \t]+)?)[ \t]*$/
function sameKind(prefix: string): { outer: string; marks: RegExp } | null {
  const found = INNERMOST.exec(prefix)
  if (!found) return null
  const [, bullet, delimiter] = found
  const marks = bullet ? new RegExp(`^\\${bullet}[ \t]`) : delimiter ? new RegExp(`^\\d+\\${delimiter}[ \t]`) : /^>/
  return { outer: prefix.slice(0, found.index), marks }
}
const FENCE = /^[ \t]*(?:`{3,}|~{3,})/
function siblingIndent(lines: readonly string[], marks: RegExp, most: number): string | null {
  let fenced = false
  let found: string | null = null
  for (const one of lines) {
    if (FENCE.test(one)) fenced = !fenced
    if (fenced || !marks.test(one.trimStart())) continue
    const indent = /^[ \t]*/.exec(one)?.[0] ?? ''
    if (indent.length <= most && (found === null || indent.length < found.length)) found = indent
  }
  return found
}
function spaced(prefix: string): string {
  return prefix.replace(ITEM_MARKS, (_all, mark: string) => ' '.repeat(mark.length))
}
const OPENS_BLOCK = /^(?:#{1,6}[ \t]|\||`{3,}|~{3,}|>[ \t]?|(?:[-*+]|\d+[.)])[ \t]|\$\$|(?:-{3,}|\*{3,}|_{3,})$)/
const TAKES_LAZY = /^[ \t]*(?:>|(?:[-*+]|\d+[.)])[ \t])/
const CLOSES_BLOCK = /^(?:#{1,6}[ \t]|\||`{3,}|~{3,}|\$\$)/
function intoEmptyItem(state: EditorState, range: SelectionRange, text: string): Landing | null {
  const line = state.doc.lineAt(range.from)
  if (!range.empty || !AN_ITEM.test(text)) return null
  const found = LEAD.exec(line.text)
  const marker = found?.[2]
  const kept = found?.[1] ?? ''
  if (!marker || line.text.trimEnd().length > kept.length + marker.trimEnd().length) return null
  if (range.from < line.from + kept.length + marker.length) return null
  const body = text.replace(/\n/g, `\n${kept}`)
  const from = line.from + kept.length
  const under = lazyLineBelow(state, line.number + 1) ? `\n${kept.trimEnd()}` : ''
  return {
    changes: { from, to: line.to, insert: body + under },
    range: EditorSelection.cursor(from + body.length),
  }
}
function inTable(state: EditorState, at: number): boolean {
  return enclosingNamed(syntaxTree(state).resolveInner(at, 1), 'Table') !== null
}
function lazyLineBelow(state: EditorState, number: number): boolean {
  if (number > state.doc.lines) return false
  const text = state.doc.line(number).text.trimStart()
  return text !== '' && !OPENS_BLOCK.test(text)
}
function keptBreak(state: EditorState, range: SelectionRange, text: string): SelectionRange {
  if (range.empty || range.to === 0 || text.endsWith('\n')) return range
  if (state.doc.lineAt(range.to).from !== range.to) return range
  return EditorSelection.range(range.from, range.to - 1)
}
export function placed(state: EditorState, written: string): TransactionSpec {
  const text = withLineFeeds(written)
  return everywhere(state, (range) => placedAt(state, keptBreak(state, range, text), text))
}
const QUOTE_MARK = /^[ \t]*>[ \t]?/
function quoteDepth(text: string): number {
  return (/^(?:[ \t]*>)*/.exec(text)?.[0] ?? '').split('>').length - 1
}
function unquoted(line: string, marks: number): string {
  let rest = line
  for (let left = marks; left > 0; left--) {
    const mark = QUOTE_MARK.exec(rest)
    if (!mark) return rest
    rest = rest.slice(mark[0].length)
  }
  return rest
}
const CALLOUT_HEAD = /^[ \t]*\[![^\]\s]+\]/
const ITEM_LEAD = /^((?:[ \t]*>)*[ \t]*)(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/
function placedAt(state: EditorState, range: SelectionRange, written: string): Landing {
  const special = intoEmptyItem(state, range, written)
  if (special) return special
  const line = state.doc.lineAt(range.from)
  const end = state.doc.lineAt(range.to)
  const before = line.text.slice(0, range.from - line.from)
  const after = end.text.slice(range.to - end.from)
  const prefix = CONTAINERS.exec(before)?.[0] ?? ''
  const lead = spaced(prefix)
  const gap = `\n${lead.trimEnd()}\n${lead}`
  const inFront = before.length === prefix.length
  const pastedDepth = inFront && quoteDepth(prefix) > 0 ? quoteDepth(written) : 0
  const nested = CALLOUT_HEAD.test(unquoted(written, pastedDepth)) ? 0 : pastedDepth
  const text = nested
    ? written
        .split('\n')
        .map((one) => unquoted(one, nested))
        .join('\n')
    : written
  const first = text.slice(0, text.indexOf('\n') + 1 || text.length).trimEnd()
  const whole = range.empty || !after.trim()
  const marked = inFront && whole && text.endsWith('\n') ? ITEM_LEAD.exec(prefix) : null
  if (marked && OPENS_BLOCK.test(first)) {
    const outer = marked[1] ?? ''
    const depth = quoteDepth(text)
    const carried = depth > 0 && AN_ITEM.test(unquoted(text, depth).trimStart())
    const insert = (range.empty ? text : text.slice(0, -1))
      .split('\n')
      .map((one) => (carried ? unquoted(one, depth) : one))
      .map((one, at, all) => (one ? outer + one : at < all.length - 1 ? outer.trimEnd() : one))
      .join('\n')
    return {
      changes: { from: line.from, to: range.empty ? line.from : range.to, insert },
      range: EditorSelection.cursor(line.from + insert.length + (range.empty ? before.length : 0)),
    }
  }
  const kind = inFront && !OPENS_BLOCK.test(first) ? sameKind(prefix) : null
  const held = (pasted: string) => {
    const [head = '', ...rest] = pasted.split('\n')
    const outer = kind ? spaced(kind.outer) : lead
    const base = kind ? siblingIndent(rest, kind.marks, outer.length) : null
    const leadOf = (one: string) =>
      base !== null && one.startsWith(base) ? outer + one.slice(base.length) : lead + one
    return [head, ...rest.map((one) => (one ? leadOf(one) : lead.trimEnd()))].join('\n')
  }
  const last = text.slice(text.lastIndexOf('\n') + 1)
  const opens = !inFront && OPENS_BLOCK.test(first)
  const closes = after.trim() !== '' && CLOSES_BLOCK.test(last)
  const doc = state.doc
  const words = (number: number) => number >= 1 && number <= doc.lines && doc.line(number).text.trim() !== ''
  const inOwnTable = inTable(state, line.from)
  const apart = (number: number) => words(number) && !(inOwnTable && inTable(state, doc.line(number).from))
  const under =
    after.trim() === '' &&
    (last.startsWith('|') ? apart(end.number + 1) : TAKES_LAZY.test(last) && lazyLineBelow(state, end.number + 1))
      ? `\n${lead.trimEnd()}`
      : ''
  const over = inFront && !before && first.startsWith('|') && apart(line.number - 1) ? '\n' : ''
  const lazyTaker = (one: string) => TAKES_LAZY.test(one) || one.trimStart().startsWith('|')
  const ahead =
    !opens &&
    !closes &&
    text.endsWith('\n') &&
    after.trim() !== '' &&
    !lazyTaker(after) &&
    text.split('\n').some(lazyTaker)
      ? `\n${lead}`
      : ''
  const plain = !opens && !closes && !under && !over && !ahead
  if (!inFront && plain && (!lead || !text.includes('\n'))) return plainAt(range, text)
  const from = opens ? line.from + before.trimEnd().length : range.from
  const to = closes ? range.to + (after.length - after.trimStart().length) : range.to
  const head = over + (opens ? gap : '') + held(text) + ahead
  return {
    changes: { from, to, insert: head + (closes || (opens && after.trim()) ? gap : '') + under },
    range: EditorSelection.cursor(from + head.length),
  }
}
export function plainly(state: EditorState, written: string): TransactionSpec {
  const text = withLineFeeds(written)
  return everywhere(state, (picked) => {
    const range = keptBreak(state, picked, text)
    return intoEmptyItem(state, range, text) ?? plainAt(range, text)
  })
}
