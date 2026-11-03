import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { enclosingNamed } from './nodes'

/** A link changed from its own menu: pointed somewhere else, or taken away with its
 *  words kept. What Chrome's editors, Obsidian, Notion and Typora all offer on a right
 *  click, and all of it a change to the text, so the undo takes it back as one step.
 *
 *  Every spelling of a link a note holds: `[words](address)`, `[words][ref]` and its
 *  short forms, `<address>`, an address written out, and `[[Note|words]]`. A picture
 *  is not one of them - its menu is its own - and neither is `![[embed]]`, which is a
 *  thing shown rather than a link. */

/** Where a link is, where it points, and what is left of it without the link. */
export interface LinkParts {
  from: number
  to: number
  /** The address or the note, as written: what editing the link selects. */
  target: { from: number; to: number }
  /** Set on a link that points by a label: `[words][label]`, `[words][]`, `[words]`. What
   *  the label says, and where a `(address)` would go in its place. What it means is
   *  asked only when the link is edited, since that takes the whole note parsed. */
  label?: { text: string; written: { from: number; to: number } }
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

/** Labels match the way CommonMark says: a case fold, which is what the round trip through
 *  upper case is for (`ß` and `SS`), and blanks in a run count as one. Wider than what
 *  `marked` matches, so a label any reader takes as defined is never taken as undefined. */
const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase()

/** How long a parse of the whole note may take when Edit link was chosen: as long as it
 *  takes. Saying a label has no definition is what rewrites the link, so it cannot be said
 *  from part of a note, and the background parse has usually finished by now anyway. */
const WHOLE_NOTE = 1e9

/** The address the first definition of a label holds, wherever in the note it is, without
 *  its `<` `>`: what is typed over it then stays in them, and may hold a blank. An empty
 *  `<>` has nothing to select, and is selected whole. */
function definedAddress(
  state: EditorState,
  tree: Tree,
  label: string,
): { from: number; to: number } | null {
  const key = labelKey(label)
  let first: SyntaxNode | null = null
  tree.iterate({
    enter(ref) {
      if (first) return false
      if (ref.name !== 'LinkReference') return ref.name !== 'Paragraph'
      const written = ref.node.getChild('LinkLabel')
      if (written && labelKey(state.doc.sliceString(written.from + 1, written.to - 1)) === key)
        first = ref.node
      return false
    },
  })
  const url = (first as SyntaxNode | null)?.getChild('URL')
  if (!url) return null
  const angled = state.doc.sliceString(url.from, url.from + 1) === '<' && url.to - url.from > 2
  return angled ? { from: url.from + 1, to: url.to - 1 } : { from: url.from, to: url.to }
}

/** A label's text as an address a link can hold: bare where it can be, in `<>` where it
 *  cannot, and never with what `<>` cannot hold. */
function addressOf(label: string): string {
  const text = label.trim().replace(/\s+/g, ' ')
  if (/^[^\s<>()\\]*$/.test(text)) return text
  return `<${text.replace(/</g, '%3C').replace(/>/g, '%3E')}>`
}

/** Swaps a label nothing defines for an address, selected so the next thing typed replaces
 *  it, and still a link if nothing is. Its own undo step whatever comes before or after:
 *  the address typed next is a second one, which takes the link back to this. */
function writeAddress(state: EditorState, label: string, written: { from: number; to: number }) {
  const address = addressOf(label)
  const at = written.from + 1
  return state.update({
    changes: { ...written, insert: `(${address})` },
    selection: EditorSelection.range(at, at + address.length),
    scrollIntoView: true,
    userEvent: 'input.link',
    annotations: isolateHistory.of('full'),
  })
}

/** Where `[words][label]`, `[words][]` and `[words]` say what they point by. */
function labelParts(
  state: EditorState,
  node: SyntaxNode,
  words: { from: number; to: number },
): Pick<LinkParts, 'target' | 'label'> {
  const written = node.getChild('LinkLabel')
  const inner = written && { from: written.from + 1, to: written.to - 1 }
  const said = inner && inner.to > inner.from ? inner : words
  return {
    target: inner ?? { from: node.to, to: node.to },
    label: {
      text: state.doc.sliceString(said.from, said.to),
      written: written ? { from: written.from, to: written.to } : { from: node.to, to: node.to },
    },
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
    : { ...parts, ...labelParts(state, node, { from: open.to, to: close.from }) }
}

/** The link at a position, of whichever spelling, or null where there is none. */
export function linkPartsAt(state: EditorState, pos: number): LinkParts | null {
  const node = linkToward(state, pos, 1) ?? linkToward(state, pos, -1)
  if (!node) return null

  return node.name === 'Wikilink' ? wikilinkParts(state, node) : markdownParts(state, node)
}

/** Selects where the link at `pos` points, which in the live preview is also what
 *  shows its markup: the next thing typed is the new address. For a link by a label that
 *  is the address its definition holds, since typing over the label would only break the
 *  link; a label nothing defines has none yet, and makes way for one. */
export function editLink(pos: number): StateCommand {
  return ({ state, dispatch }) => {
    const parts = state.readOnly ? null : linkPartsAt(state, pos)
    if (!parts) return false

    let target = parts.target
    if (parts.label) {
      const tree = ensureSyntaxTree(state, state.doc.length, WHOLE_NOTE)
      if (!tree) return false
      const address = definedAddress(state, tree, parts.label.text)
      if (!address) {
        dispatch(
          writeAddress(state, state.doc.sliceString(target.from, target.to), parts.label.written),
        )
        return true
      }
      target = address
    }

    dispatch(
      state.update({
        selection: EditorSelection.range(target.from, target.to),
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
