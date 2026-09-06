import { Decoration } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

/** Which nodes are syntax the preview hides, and the two decorations it hides
 *  and shows them with.
 *
 *  A file of its own because two parts of the preview have to agree on the
 *  answer: decorate.ts, which hides a mark, and snap.ts, which decides where a
 *  click beside a hidden one puts the caret. A second list would drift, and the
 *  drift would show as a caret that lands inside a mark nobody can see. */

/** Hidden text: replaced by nothing, and made atomic so the caret steps over it
 *  rather than into it. */
export const hide = Decoration.replace({})

/** Shown text, tagged so the stylesheet can bleed a revealed mark back in
 *  rather than having it appear. */
export const meta = Decoration.mark({ class: 'md-meta' })

/** Syntax characters that vanish unless the caret is inside their construct. */
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

/** Whether a node is syntax the preview hides, as opposed to text it shows.
 *  A URL is syntax inside a link or an image, where the label stands for it;
 *  on its own, or between the `<` `>` of an autolink, it is the text. */
export function concealable(node: SyntaxNode): boolean {
  if (node.name === 'URL') return node.parent?.name === 'Link' || node.parent?.name === 'Image'
  return INLINE_MARKS.has(node.name)
}
