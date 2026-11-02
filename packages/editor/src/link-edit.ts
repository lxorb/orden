import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { enclosingNamed } from './nodes'

/** A link changed from its own menu: pointed somewhere else, or taken away with its
 *  words kept. What Chrome's editors, Obsidian, Notion and Typora all offer on a right
 *  click, and all of it a change to the text, so the undo takes it back as one step.
 *
 *  Every spelling of a link a note holds: `[words](address)`, `<address>`, an address
 *  written out, and `[[Note|words]]`. A picture is not one of them - its menu is its
 *  own - and neither is `![[embed]]`, which is a thing shown rather than a link. */

/** Where a link is, where it points, and what is left of it without the link. */
export interface LinkParts {
  from: number
  to: number
  /** The address or the note, as written: what editing the link selects. */
  target: { from: number; to: number }
  /** A label no definition answers, brackets and all, or the empty spot where one is
   *  left out: what editing swaps for `(label)`, so that the address typed is a link. */
  unwritten?: { from: number; to: number }
  /** The words a reader sees, or null where taking the link away would leave the same
   *  link behind: an address written out is a link by being one. */
  words: string | null
}

const LINKS = new Set(['Link', 'Autolink', 'URL', 'Wikilink'])

/** The innermost link around a position, looking to one side of it. An address inside
 *  `[…](…)` or `<…>` belongs to the link it is written in, and one inside a picture or
 *  a reference definition is no link of its own. */
function linkToward(state: EditorState, pos: number, side: 1 | -1): SyntaxNode | null {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, side), LINKS)
  if (node?.name !== 'URL') return node

  const parent = node.parent?.name
  if (parent === 'Link' || parent === 'Autolink') return node.parent
  return parent === 'Image' || parent === 'LinkReference' ? null : node
}

function wikilinkParts(state: EditorState, node: SyntaxNode): LinkParts | null {
  const open = node.firstChild
  const close = node.lastChild
  if (!open || !close || open === close) return null
  if (state.doc.sliceString(open.from, open.from + 1) === '!') return null

  // `[[Note#heading|words]]` parses with everything up to the bar in its opening mark,
  // so a mark longer than the two brackets is a link with words of its own.
  const inner = open.from + 2
  const aliased = open.to > inner

  return {
    from: node.from,
    to: node.to,
    target: { from: inner, to: aliased ? open.to - 1 : close.from },
    words: state.doc.sliceString(aliased ? open.to : inner, close.from),
  }
}

/** Labels match the way a reader matches them: case and runs of blanks do not count. */
const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()

/** The address the first definition of a label holds, wherever in the note it is. */
function definedAddress(state: EditorState, label: string): SyntaxNode | null {
  const key = labelKey(label)
  // Asked of the whole note: a definition usually sits at the end of it, past what has
  // been parsed for the screen, and missing it would read as a label nothing defines.
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  let found: SyntaxNode | null = null
  tree.iterate({
    enter(ref) {
      if (found) return false
      if (ref.name !== 'LinkReference') return ref.name !== 'Paragraph'
      const written = ref.node.getChild('LinkLabel')
      if (written && labelKey(state.doc.sliceString(written.from + 1, written.to - 1)) === key)
        found = ref.node.getChild('URL')
      return false
    },
  })
  return found
}

/** Where `[words][label]`, `[words][]` and `[words]` point: the address their definition
 *  holds, since typing over the label would only break the link. With no definition
 *  there is no address yet, so the label has to make way for one. */
function labelTarget(
  state: EditorState,
  node: SyntaxNode,
  words: { from: number; to: number },
): Pick<LinkParts, 'target' | 'unwritten'> {
  const written = node.getChild('LinkLabel')
  const inner = written && { from: written.from + 1, to: written.to - 1 }
  const label = inner && inner.to > inner.from ? inner : words

  const address = definedAddress(state, state.doc.sliceString(label.from, label.to))
  if (address) return { target: { from: address.from, to: address.to } }
  return {
    target: inner ?? { from: node.to, to: node.to },
    unwritten: written ? { from: written.from, to: written.to } : { from: node.to, to: node.to },
  }
}

function markdownParts(state: EditorState, node: SyntaxNode): LinkParts {
  const marks = node.getChildren('LinkMark')
  // An address written out is its own pointer.
  const pointer = node.name === 'URL' ? node : node.getChild('URL')
  // `[words]()` points nowhere yet, and editing it is typing between the brackets.
  const empty = marks[3] ? { from: marks[2]?.to ?? node.to, to: marks[3].from } : null
  const target = pointer
    ? { from: pointer.from, to: pointer.to }
    : (empty ?? { from: node.to, to: node.to })

  if (node.name !== 'Link') return { from: node.from, to: node.to, target, words: null }

  const open = marks[0]
  const close = marks[1]
  const parts = {
    from: node.from,
    to: node.to,
    target,
    words: open && close ? state.doc.sliceString(open.to, close.from) : null,
  }
  return pointer || empty || !open || !close
    ? parts
    : { ...parts, ...labelTarget(state, node, { from: open.to, to: close.from }) }
}

/** The link at a position, of whichever spelling, or null where there is none. */
export function linkPartsAt(state: EditorState, pos: number): LinkParts | null {
  const node = linkToward(state, pos, 1) ?? linkToward(state, pos, -1)
  if (!node) return null

  return node.name === 'Wikilink' ? wikilinkParts(state, node) : markdownParts(state, node)
}

/** Selects where the link at `pos` points, which in the live preview is also what
 *  shows its markup: the next thing typed is the new address. */
export function editLink(pos: number): StateCommand {
  return ({ state, dispatch }) => {
    const parts = state.readOnly ? null : linkPartsAt(state, pos)
    if (!parts) return false

    if (parts.unwritten) {
      const label = state.doc.sliceString(parts.target.from, parts.target.to)
      const at = parts.unwritten.from + 1
      dispatch(
        state.update({
          changes: { ...parts.unwritten, insert: `(${label})` },
          selection: EditorSelection.range(at, at + label.length),
          scrollIntoView: true,
          userEvent: 'input',
        }),
      )
      return true
    }

    dispatch(
      state.update({
        selection: EditorSelection.range(parts.target.from, parts.target.to),
        scrollIntoView: true,
        userEvent: 'select',
      }),
    )
    return true
  }
}

/** Takes the link at `pos` away and leaves its words where it was. */
export function removeLink(pos: number): StateCommand {
  return ({ state, dispatch }) => {
    const parts = state.readOnly ? null : linkPartsAt(state, pos)
    const words = parts?.words ?? null
    if (!parts || words === null) return false

    dispatch(
      state.update({
        changes: { from: parts.from, to: parts.to, insert: words },
        userEvent: 'delete.link',
      }),
    )
    return true
  }
}
