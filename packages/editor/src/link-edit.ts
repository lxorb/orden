import { isolateHistory } from '@codemirror/commands'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { enclosingNamed } from './nodes'

export interface LinkParts {
  from: number
  to: number
  target: { from: number; to: number }
  label?: { text: string; written: { from: number; to: number } }
  words: string | null
}

const LINKS = new Set(['Link', 'Autolink', 'URL', 'Wikilink'])

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

  const inner = open.from + 2
  const aliased = open.to > inner

  return {
    from: node.from,
    to: node.to,
    target: { from: inner, to: aliased ? open.to - 1 : close.from },
    words: state.doc.sliceString(aliased ? open.to : inner, close.from),
  }
}

const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase()

const WHOLE_NOTE = 1e9

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

function addressOf(label: string): string {
  const text = label.trim().replace(/\s+/g, ' ')
  if (/^[^\s<>()\\]*$/.test(text)) return text
  return `<${text.replace(/</g, '%3C').replace(/>/g, '%3E')}>`
}

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
  const pointer = node.name === 'URL' ? node : node.getChild('URL')
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

export function linkPartsAt(state: EditorState, pos: number): LinkParts | null {
  const node = linkToward(state, pos, 1) ?? linkToward(state, pos, -1)
  if (!node) return null

  return node.name === 'Wikilink' ? wikilinkParts(state, node) : markdownParts(state, node)
}

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
