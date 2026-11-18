import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { linkDestination } from '../links'
import { linkAddress, linkBrackets } from '../nodes'

const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem'])

const labelKey = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase()

const known = new WeakMap<Tree, Map<string, string>>()

function definitions(state: EditorState): Map<string, string> {
  const tree = syntaxTree(state)
  const cached = known.get(tree)
  if (cached) return cached

  const found = new Map<string, string>()
  const { doc } = state
  tree.iterate({
    enter: (ref) => {
      if (ref.name !== 'LinkReference') return CONTAINERS.has(ref.name)
      const written = ref.node.getChild('LinkLabel')
      const url = ref.node.getChild('URL')
      if (!written) return false
      const key = labelKey(doc.sliceString(written.from + 1, written.to - 1))
      if (!found.has(key)) {
        found.set(key, url ? linkDestination(doc.sliceString(url.from, url.to)) : '')
      }
      return false
    },
  })
  known.set(tree, found)
  return found
}

function definitionOf(state: EditorState, label: string): string | undefined {
  return definitions(state).get(labelKey(label))
}

export function referenceOf(
  state: EditorState,
  link: SyntaxNode,
): { target: string | undefined; label: SyntaxNode | null } | null {
  const brackets = linkBrackets(link)
  if (!brackets || linkAddress(link) || link.getChildren('LinkMark').length > 2) return null
  const label = link.getChild('LinkLabel')
  const named = label && label.to - label.from > 2
  const key = named
    ? state.doc.sliceString(label.from + 1, label.to - 1)
    : state.doc.sliceString(brackets.open.to, brackets.close.from)
  return { target: definitionOf(state, key), label }
}

export function unlinked(state: EditorState, link: SyntaxNode): boolean {
  if (link.name !== 'Link' && link.name !== 'Image') return false
  const reference = referenceOf(state, link)
  return reference !== null && reference.target === undefined
}
