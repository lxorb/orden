import { Decoration } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

export const hide = Decoration.replace({})

export const meta = Decoration.mark({ class: 'md-meta' })

const INLINE_MARKS = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'SubscriptMark',
  'SuperscriptMark',
  'HighlightMark',
  'MathMark',
  'FootnoteMark',
  'DefinitionMark',
  'AbbrevMark',
  'FrontMatterMark',
  'LinkMark',
  'URL',
  'LinkTitle',
])

export function concealable(node: SyntaxNode): boolean {
  if (node.name === 'URL') return node.parent?.name === 'Link' || node.parent?.name === 'Image'
  return INLINE_MARKS.has(node.name)
}
