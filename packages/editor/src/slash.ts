import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { enclosingNamed } from './nodes'

export interface SlashBlock {
  label: string
  run: (view: EditorView) => void
}

let rows: () => SlashBlock[] = () => []

export function setBlocks(next: () => SlashBlock[]) {
  rows = next
}

const TYPED = /(?:^|\s)\/([\w-]*)$/

const VERBATIM = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'CodeMark'])

function inCode(context: CompletionContext): boolean {
  const at = syntaxTree(context.state).resolveInner(context.pos, -1)
  return enclosingNamed(at, VERBATIM) !== null
}

function insert(block: SlashBlock) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from: from - 1, to },
      selection: { anchor: from - 1 },
      userEvent: 'input.complete',
    })

    block.run(view)
  }
}

export function slashCompletions(context: CompletionContext): CompletionResult | null {
  const blocks = rows()
  if (!blocks.length) return null

  const line = context.state.doc.lineAt(context.pos)
  const typed = TYPED.exec(line.text.slice(0, context.pos - line.from))
  if (!typed || inCode(context)) return null

  return {
    from: context.pos - (typed[1] ?? '').length,
    options: blocks.map((block, at) => ({
      label: block.label,
      apply: insert(block),
      type: 'text',
      boost: blocks.length - at,
    })),
    validFor: /^[\w-]*$/,
  }
}
