import { foldable, syntaxTree } from '@codemirror/language'
import type { EditorState, Line } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { headingLevel } from '../headings'
import { enclosing } from '../nodes'

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'quote'
  | 'code'
  | 'table'
  | 'math'
  | 'front-matter'
  | 'rule'
  | 'block'

export interface BlockSpan {
  from: number
  to: number
  kind: BlockKind
}

const KINDS: Readonly<Record<string, BlockKind>> = {
  Paragraph: 'paragraph',
  Blockquote: 'quote',
  ListItem: 'list',
  FencedCode: 'code',
  CodeBlock: 'code',
  Table: 'table',
  BlockMath: 'math',
  FrontMatter: 'front-matter',
  HorizontalRule: 'rule',
  HTMLBlock: 'block',
  LinkReference: 'block',
  CommentBlock: 'block',
}

function kindOf(name: string): BlockKind | null {
  if (headingLevel(name) !== null) return 'heading'
  return KINDS[name] ?? null
}

function spanOf(state: EditorState, node: SyntaxNode, kind: BlockKind): BlockSpan {
  const doc = state.doc
  const first = doc.lineAt(node.from)

  if (kind === 'heading') {
    const section = foldable(state, first.from, first.to)
    return { from: first.from, to: section ? section.to : first.to, kind }
  }

  return { from: first.from, to: doc.lineAt(Math.min(node.to, doc.length)).to, kind }
}

export function blocksIn(state: EditorState, from: number, to: number): BlockSpan[] {
  const doc = state.doc
  const found: BlockSpan[] = []
  const taken = new Set<number>()

  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      const kind = kindOf(node.name)
      if (!kind) return true

      const span = spanOf(state, node.node, kind)
      const line = doc.lineAt(span.from).from
      if (!taken.has(line)) {
        taken.add(line)
        found.push(span)
      }

      return kind === 'list'
    },
  })

  return found.sort((one, other) => one.from - other.from)
}

export function blockAt(state: EditorState, pos: number): BlockSpan | null {
  const line = state.doc.lineAt(pos)
  const starting = blocksIn(state, line.from, line.to).find(
    (span) => state.doc.lineAt(span.from).from === line.from,
  )
  if (starting) return starting

  let found: BlockSpan | null = null
  for (const node of enclosing(syntaxTree(state).resolveInner(pos, -1))) {
    const kind = kindOf(node.name)
    if (kind) found = spanOf(state, node.node, kind)
  }

  return found
}

export function writtenLine(state: EditorState, number: number, delta: -1 | 1): Line | null {
  const doc = state.doc

  for (let at = number; at >= 1 && at <= doc.lines; at += delta) {
    const line = doc.line(at)
    if (line.text.trim()) return line
  }

  return null
}
