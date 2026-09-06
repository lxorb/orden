import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, Prec } from '@codemirror/state'
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

/** Code spans keep their straight quotes. Read from the line alone, so it holds
 *  before the parser has caught up: an indented block, a fence line, and an odd
 *  number of backticks behind the caret. */
export function inCodeSpan(lineText: string, offset: number): boolean {
  if (/^(\s{4,}|\s*(```|~~~))/.test(lineText)) return true
  return (lineText.slice(0, offset).match(/`/g)?.length ?? 0) % 2 === 1
}

/** Constructs whose text is not prose, and where a straight quote, a double
 *  hyphen or a run of dots means exactly what it says.
 *
 *  Maths is here because `'` is prime notation and `--` is a comment in some of
 *  what people write in it; a URL and a link title because they are addresses;
 *  front matter because it is YAML; an HTML tag because its attributes are
 *  quoted with the straight character or not at all. */
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

/** Whether the character about to be typed at `pos` belongs to something that
 *  is not prose.
 *
 *  Both halves are asked, because neither is enough on its own. The line cannot
 *  see that it is the third line of a fenced block - it reads as ordinary prose,
 *  which is how a straight quote typed into JavaScript inside a fence used to
 *  come out curled. The tree cannot see a construct the parser has not reached
 *  yet, or one that is not a construct until it is closed. */
export function keepsStraightQuotes(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  if (inCodeSpan(line.text, pos - line.from)) return true

  for (let node = syntaxTree(state).resolveInner(pos, -1); node.parent; node = node.parent) {
    if (STRAIGHT.has(node.name)) return true
  }
  return false
}

export function smartPunctuation(): Extension {
  // Ahead of the default handlers so the raw character never lands first.
  return Prec.high(
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text.length !== 1 || !`"'-.`.includes(text)) return false

      if (keepsStraightQuotes(view.state, from)) return false

      const line = view.state.doc.lineAt(from)
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
