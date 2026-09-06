import { type Extension, Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** Substitutions applied as you type, matching Typora's smart punctuation.
 *  Order matters: the opening-quote rules must be tried before the closing
 *  ones, and the em dash before the en dash it is built from. */
const RULES: { pattern: RegExp; insert: string }[] = [
  { pattern: /(?:^|[\s([{"'])(")$/, insert: '“' },
  { pattern: /(")$/, insert: '”' },
  { pattern: /(?:^|[\s([{"“])(')$/, insert: '‘' },
  { pattern: /(')$/, insert: '’' },
  { pattern: /(–-)$/, insert: '—' },
  { pattern: /(--)$/, insert: '–' },
  { pattern: /(\.\.\.)$/, insert: '…' },
]

export interface Replacement {
  /** How many characters before the caret the replacement covers. */
  consumed: number
  insert: string
}

/** Decides what a freshly typed character should become, given the line text up
 *  to and including it. Pure, so the behaviour is testable without a view. */
export function smartReplacement(before: string): Replacement | null {
  for (const rule of RULES) {
    // Every rule captures exactly the characters it replaces, so a match has
    // group one; the default is what satisfies a compiler that cannot see that.
    const [, replaced = ''] = rule.pattern.exec(before) ?? []
    if (replaced) return { consumed: replaced.length, insert: rule.insert }
  }
  return null
}

/** Code spans keep their straight quotes. */
export function inCodeSpan(lineText: string, offset: number): boolean {
  if (/^(\s{4,}|\s*(```|~~~))/.test(lineText)) return true
  return (lineText.slice(0, offset).match(/`/g)?.length ?? 0) % 2 === 1
}

export function smartPunctuation(): Extension {
  // Ahead of the default handlers so the raw character never lands first.
  return Prec.high(
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text.length !== 1 || !`"'-.`.includes(text)) return false

      const line = view.state.doc.lineAt(from)
      if (inCodeSpan(line.text, from - line.from)) return false

      const replacement = smartReplacement(view.state.doc.sliceString(line.from, from) + text)
      if (!replacement) return false

      // `consumed` counts the typed character too, so step back the rest.
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
