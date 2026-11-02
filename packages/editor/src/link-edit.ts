import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { enclosingNamed } from './nodes'

/** A link changed from its own menu: pointed somewhere else, or taken away with its
 *  words kept. What Chrome's editors, Obsidian, Notion and Typora all offer on a right
 *  click, and all of it a change to the text, so the undo takes it back as one step.
 *
 *  Every spelling of a link a note holds: `[words](address)`, `[words][ref]` and its
 *  short forms, `<address>`, an address written out, and `[[Note|words]]`. A picture
 *  is not one of them - its menu is its own - and neither is `![[embed]]`, which is a thing shown rather than a link. */

/** Where a link is, where it points, and what is left of it without the link. */
export interface LinkParts {
  from: number
  to: number
  /** The address or the note, as written: what editing the link selects. */
  target: { from: number; to: number }
  /** Written over `target` before editing, for a reference no definition answers:
   *  the link then points nowhere yet, and the address is typed between its brackets. */
  fill?: '()'
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

/** A reference's label the way CommonMark matches it to a definition. */
const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase()

/** The address the first definition of `label` gives, without its `<` `>`. Read off
 *  the whole note, since definitions are mostly written at its end. */
function definedAddress(state: EditorState, label: string): { from: number; to: number } | null {
  const key = labelKey(label)
  let found: { from: number; to: number } | null = null
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state)
  tree.iterate({
    enter: (node) => {
      if (found) return false
      if (node.name !== 'LinkReference') return true
      const name = node.node.getChild('LinkLabel')
      const url = node.node.getChild('URL')
      if (name && url && labelKey(state.doc.sliceString(name.from + 1, name.to - 1)) === key) {
        const angled = state.doc.sliceString(url.from, url.from + 1) === '<'
        found = angled ? { from: url.from + 1, to: url.to - 1 } : { from: url.from, to: url.to }
      }
      return false
    },
  })
  return found
}

function markdownParts(state: EditorState, node: SyntaxNode): LinkParts {
  const marks = node.getChildren('LinkMark')
  const words =
    node.name === 'Link' && marks[0] && marks[1]
      ? state.doc.sliceString(marks[0].to, marks[1].from)
      : null
  const parts = (target: LinkParts['target'], fill?: '()'): LinkParts => ({
    from: node.from,
    to: node.to,
    target,
    words,
    ...(fill ? { fill } : {}),
  })

  // An address written out is its own pointer.
  const url = node.name === 'URL' ? node : node.getChild('URL')
  if (url) return parts({ from: url.from, to: url.to })
  // `[words]()` points nowhere yet, and editing it is typing between the brackets.
  if (marks[3]) return parts({ from: marks[2]?.to ?? node.to, to: marks[3].from })
  if (node.name !== 'Link') return parts({ from: node.to, to: node.to })

  // `[words][ref]`, `[words][]` and `[words]` point where the definition of their
  // label, or of their words, says: that address is what editing them changes, for
  // every link that shares it. Without one they point nowhere yet, and become the
  // `[words]()` above, the label they named making way for the brackets.
  const label = node.getChild('LinkLabel')
  const named = label ? state.doc.sliceString(label.from + 1, label.to - 1) : ''
  const address = definedAddress(state, named.trim() ? named : (words ?? ''))
  return address ? parts(address) : parts({ from: label?.from ?? node.to, to: node.to }, '()')
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

    const { target, fill } = parts
    dispatch(
      state.update(
        fill
          ? {
              changes: { from: target.from, to: target.to, insert: fill },
              selection: EditorSelection.cursor(target.from + 1),
              scrollIntoView: true,
              userEvent: 'input',
            }
          : {
              selection: EditorSelection.range(target.from, target.to),
              scrollIntoView: true,
              userEvent: 'select',
            },
      ),
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
