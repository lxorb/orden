import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { enclosingNamed } from './nodes'

const RULES: { pattern: RegExp; insert: string; dash?: boolean }[] = [
  { pattern: /(?:^|[\s([{"'])(")$/, insert: '“' },
  { pattern: /(")$/, insert: '”' },
  { pattern: /(?:^|[\s([{"“])(')$/, insert: '‘' },
  { pattern: /(')$/, insert: '’' },
  { pattern: /(–-)$/, insert: '—', dash: true },
  { pattern: /(--)$/, insert: '–', dash: true },
  { pattern: /(\.\.\.)$/, insert: '…' },
]

const BREAK = /^[ \t]{0,3}(?:>[ \t]*)*[-*_]+$/

export interface Replacement {
  consumed: number
  insert: string
}

export function typingBreak(before: string): boolean {
  return BREAK.test(before)
}

const DIVIDER_ROW = /^[ \t]*(?:>[ \t]*)*\|?[ \t:|-]*$/
const COMMENT_OPENING = /<!-?-?$/
const TAG_OPEN =
  /<[A-Za-z][\w-]*(?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s+[\w:-]+\s*=\s*(?:"[^"]*|'[^']*)?$/

function withinMaths(before: string): boolean {
  const bare = before.replace(/\\./g, '').replace(/(`+)[\s\S]*?\1/g, '')
  let open = false
  for (let at = bare.indexOf('$'); at >= 0; at = bare.indexOf('$', at + 1)) {
    if (open) open = /\s/.test(bare[at - 1] ?? ' ')
    else open = !/[\s\d]/.test(bare[at + 1] ?? ' ')
  }
  return open
}

function withinOpen(before: string, opening: string, closing: string): boolean {
  const opened = before.lastIndexOf(opening)
  return opened >= 0 && !before.includes(closing, opened + opening.length)
}

function writingMarkup(before: string): boolean {
  return (
    withinOpen(before, '[[', ']]') ||
    withinOpen(before, '<!--', '-->') ||
    withinOpen(before, '](', ')') ||
    TAG_OPEN.test(before.slice(0, -1)) ||
    withinMaths(before) ||
    COMMENT_OPENING.test(before.slice(0, -1))
  )
}

export function smartReplacement(before: string): Replacement | null {
  if (writingMarkup(before)) return null
  const markup = typingBreak(before) || (before.includes('|') && DIVIDER_ROW.test(before))

  for (const rule of RULES) {
    if (markup && rule.dash) continue

    const [, replaced = ''] = rule.pattern.exec(before) ?? []
    if (replaced) return { consumed: replaced.length, insert: rule.insert }
  }
  return null
}

export function inCodeSpan(lineText: string, offset: number, inItem = false): boolean {
  if (/^\s*(```|~~~)/.test(lineText)) return true
  if (!inItem && /^\s{4,}/.test(lineText)) return true
  return (lineText.slice(0, offset).match(/`/g)?.length ?? 0) % 2 === 1
}

const STRAIGHT = new Set([
  'InlineCode',
  'CodeText',
  'CodeMark',
  'CodeInfo',
  'FencedCode',
  'CodeBlock',
  'InlineMath',
  'BlockMath',
  'FrontMatter',
  'HTMLTag',
  'HTMLBlock',
  'Comment',
  'CommentBlock',
  'URL',
  'LinkTitle',
])

function inOpenFrontMatter(state: EditorState, pos: number): boolean {
  const doc = state.doc
  const at = doc.lineAt(pos).number
  if (at < 2 || doc.line(1).text.trimEnd() !== '---') return false
  for (let number = 2; number < at; number++) {
    const text = doc.line(number).text.trimEnd()
    if (text === '' || text === '---' || text === '...') return false
  }
  return true
}

export function keepsStraightQuotes(state: EditorState, pos: number): boolean {
  if (inOpenFrontMatter(state, pos)) return true
  const line = state.doc.lineAt(pos)
  const inner = syntaxTree(state).resolveInner(pos, -1)
  const inItem = enclosingNamed(inner, 'ListItem') !== null
  if (inCodeSpan(line.text, pos - line.from, inItem)) return true

  return enclosingNamed(inner, STRAIGHT) !== null
}

export function smartPunctuation(): Extension {
  return Prec.high(
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text.length !== 1 || !`"'-.`.includes(text)) return false

      if (keepsStraightQuotes(view.state, from)) return false

      const line = view.state.doc.lineAt(from)
      const replacement = smartReplacement(view.state.doc.sliceString(line.from, from) + text)
      if (!replacement) return false

      const start = from - (replacement.consumed - 1)

      view.dispatch({
        changes: { from: start, to, insert: replacement.insert },
        selection: { anchor: start + replacement.insert.length },
        userEvent: 'input.type',
      })
      return true
    }),
  )
}
