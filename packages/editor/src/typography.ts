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

export function smartReplacement(before: string): Replacement | null {
  const markup = typingBreak(before)

  for (const rule of RULES) {
    if (markup && rule.dash) continue

    const [, replaced = ''] = rule.pattern.exec(before) ?? []
    if (replaced) return { consumed: replaced.length, insert: rule.insert }
  }
  return null
}

export function inCodeSpan(lineText: string, offset: number): boolean {
  if (/^(\s{4,}|\s*(```|~~~))/.test(lineText)) return true
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

export function keepsStraightQuotes(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  if (inCodeSpan(line.text, pos - line.from)) return true

  return enclosingNamed(syntaxTree(state).resolveInner(pos, -1), STRAIGHT) !== null
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
