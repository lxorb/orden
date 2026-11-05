import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import { inserted } from './paste'

const LEAD = /^([ \t]*(?:>[ \t]?)*[ \t]*)((?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/

const AN_ITEM = /^(?:[-*+]|\d+[.)])[ \t]/

const OPENS_BLOCK =
  /^(?:#{1,6}[ \t]|\||`{3,}|~{3,}|>[ \t]?|(?:[-*+]|\d+[.)])[ \t]|\$\$|(?:-{3,}|\*{3,}|_{3,})$)/

const CLOSES_BLOCK = /^(?:#{1,6}[ \t]|\||`{3,}|~{3,}|\$\$)/

function intoEmptyItem(state: EditorState, text: string): TransactionSpec | null {
  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  if (!range.empty || !AN_ITEM.test(text)) return null

  const found = LEAD.exec(line.text)
  const marker = found?.[2]
  const kept = found?.[1] ?? ''
  if (!marker || line.text.trimEnd().length > kept.length + marker.trimEnd().length) return null
  if (range.from < line.from + kept.length + marker.length) return null

  const body = text.replace(/\n/g, `\n${kept}`)
  const from = line.from + kept.length
  return {
    changes: { from, to: line.to, insert: body },
    selection: EditorSelection.cursor(from + body.length),
    scrollIntoView: true,
    userEvent: 'input.paste',
  }
}

export function placed(state: EditorState, text: string): TransactionSpec {
  const special = intoEmptyItem(state, text)
  if (special) return special

  const range = state.selection.main
  const line = state.doc.lineAt(range.from)
  const end = state.doc.lineAt(range.to)
  const before = line.text.slice(0, range.from - line.from)
  const after = end.text.slice(range.to - end.from)

  const found = LEAD.exec(before)
  const kept = found?.[1] ?? ''
  const marker = found?.[2] ?? ''
  const lead = kept + ' '.repeat(marker.length)
  const held = (lines: string) =>
    lines.replace(/\n([^\n]*)/g, (_all, one: string) => `\n${one ? lead + one : lead.trimEnd()}`)
  const gap = `\n${lead.trimEnd()}\n${lead}`

  const inFront = before.length === kept.length + marker.length
  const first = text.slice(0, text.indexOf('\n') + 1 || text.length).trimEnd()
  const last = text.slice(text.lastIndexOf('\n') + 1)
  const opens = !inFront && OPENS_BLOCK.test(first)
  const closes = after.trim() !== '' && CLOSES_BLOCK.test(last)
  const doc = state.doc
  const words = (number: number) =>
    number >= 1 && number <= doc.lines && doc.line(number).text.trim() !== ''
  const under =
    after.trim() === '' && last.startsWith('|') && words(end.number + 1)
      ? `\n${lead.trimEnd()}`
      : ''
  const over = inFront && !before && first.startsWith('|') && words(line.number - 1) ? '\n' : ''
  const plain = !opens && !closes && !under && !over
  if (!inFront && plain && (!lead || !text.includes('\n'))) return inserted(state, text)

  const from = opens ? line.from + before.trimEnd().length : range.from
  const to = closes ? range.to + (after.length - after.trimStart().length) : range.to
  const head = over + (opens ? gap : '') + held(text)

  return {
    changes: { from, to, insert: head + (closes || (opens && after.trim()) ? gap : '') + under },
    selection: EditorSelection.cursor(from + head.length),
    scrollIntoView: true,
    userEvent: 'input.paste',
  }
}

export function plainly(state: EditorState, text: string): TransactionSpec {
  return intoEmptyItem(state, text) ?? inserted(state, text)
}
