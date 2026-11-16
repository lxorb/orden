import { Decoration } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { linkAddress } from '../nodes'

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
  if (node.name === 'URL') {
    const link = node.parent
    if (link?.name !== 'Link' && link?.name !== 'Image') return false
    return linkAddress(link)?.from === node.from
  }
  return INLINE_MARKS.has(node.name)
}
