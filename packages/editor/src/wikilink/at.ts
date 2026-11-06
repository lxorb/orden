import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import {
  decodeFragment,
  decodeTarget,
  isNoteTarget,
  type LinkKind,
  parseWikilink,
  type Wikilink,
} from '@orden/markdown/links'
import { enclosingNamed } from '../nodes'

export interface LinkSpan extends Wikilink {
  kind: LinkKind
  from: number
  to: number
}

export function wikilinkOfNode(state: EditorState, node: SyntaxNode): LinkSpan | null {
  const text = state.doc.sliceString(node.from, node.to)
  const embed = text.startsWith('!')
  const inner = text.slice(embed ? 3 : 2, -2)

  const link = parseWikilink(inner, embed)
  return link && { ...link, kind: 'wikilink', from: node.from, to: node.to }
}

export function noteLinkOfNode(state: EditorState, node: SyntaxNode): LinkSpan | null {
  const url = node.getChild('URL')
  if (!url) return null

  const written = state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, '')
  if (!isNoteTarget(written)) return null

  const hash = written.indexOf('#')
  const target = decodeTarget(hash === -1 ? written : written.slice(0, hash))
  const fragment = hash === -1 ? '' : decodeFragment(written.slice(hash + 1))
  if (!target && !fragment) return null

  const open = node.firstChild
  const close = open?.nextSibling
  const label =
    open && close && open.name === 'LinkMark' && close.name === 'LinkMark'
      ? state.doc.sliceString(open.to, close.from)
      : ''

  const block = fragment.startsWith('^') ? fragment.slice(1) : null

  return {
    target,
    heading: block === null ? fragment || null : null,
    block,
    alias: label,
    embed: node.name === 'Image',
    kind: 'markdown',
    from: node.from,
    to: node.to,
  }
}

const LINKS = new Set(['Wikilink', 'Link', 'Image'])

function linkToward(state: EditorState, pos: number, side: 1 | -1): LinkSpan | null {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, side), LINKS)
  if (!node) return null

  return node.name === 'Wikilink' ? wikilinkOfNode(state, node) : noteLinkOfNode(state, node)
}

export function linkAt(state: EditorState, pos: number): LinkSpan | null {
  return linkToward(state, pos, 1) ?? linkToward(state, pos, -1)
}
