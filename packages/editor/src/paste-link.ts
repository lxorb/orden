import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type TransactionSpec,
} from '@codemirror/state'
import type { Tree } from '@lezer/common'
import { inCode } from './code'
import { enclosingNamed } from './nodes'
import { ADDRESS } from './paste'

const NOT_WORDS = new Set([
  'Link',
  'Image',
  'URL',
  'Autolink',
  'Wikilink',
  'LinkReference',
  'InlineMath',
  'BlockMath',
  'HTMLTag',
  'HTMLBlock',
  'CommentBlock',
  'Comment',
  'FrontMatter',
])

function linkable(state: EditorState, range: SelectionRange): boolean {
  if (range.empty) return false

  const words = state.sliceDoc(range.from, range.to)
  if (/\n[ \t]*\n/.test(words) || ADDRESS.test(words.trim())) return false

  const tree = syntaxTree(state)
  if (halfOfSomething(tree, range.from, range.to)) return false

  for (const [pos, side] of [
    [range.from, 1],
    [range.to, -1],
  ] as const) {
    if (inCode(state, pos, side)) return false
    if (enclosingNamed(tree.resolveInner(pos, side), NOT_WORDS)) return false
  }

  return true
}

function halfOfSomething(tree: Tree, from: number, to: number): boolean {
  let half = false
  tree.iterate({
    from,
    to,
    enter: (node) => {
      const startsInside = node.from > from && node.from < to
      const endsInside = node.to > from && node.to < to
      if ((startsInside && node.to > to) || (endsInside && node.from < from)) half = true
      return !half
    },
  })
  return half
}

function label(state: EditorState, from: number, to: number): string {
  const tree = syntaxTree(state)
  return state.sliceDoc(from, to).replace(/[[\]]/g, (bracket, at: number) => {
    const node = tree.resolveInner(from + at, 1)
    const markup = /Mark|Escape/.test(node.name) || enclosingNamed(node, NOT_WORDS) !== null
    return markup || inCode(state, from + at) ? bracket : `\\${bracket}`
  })
}

function destination(typed: string): string {
  const address = /^www\./i.test(typed) ? `https://${typed}` : typed
  let depth = 0
  for (const char of address) {
    if (char === '(') depth += 1
    if (char === ')' && --depth < 0) break
  }
  return depth === 0 ? address : `<${address}>`
}

export function linkedPaste(state: EditorState, text: string): TransactionSpec | null {
  const address = text.trim()
  if (!ADDRESS.test(address)) return null
  if (!state.selection.ranges.every((range) => linkable(state, range))) return null

  const target = destination(address)
  return {
    ...state.changeByRange((range) => {
      const insert = `[${label(state, range.from, range.to)}](${target})`
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + insert.length),
      }
    }),
    scrollIntoView: true,
    userEvent: 'input.paste',
  }
}
