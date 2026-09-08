/** A space's tags as the tree their slashes already describe.
 *
 *  `work/nib/canvas` is a path, the way Obsidian and Notable read one: a note
 *  tagged with it is a note under `work/nib` and under `work` as well, to any
 *  depth. The `tag:` operator has always read the slashes that way; this is the
 *  same fact drawn, so a space can be looked through by its tags rather than
 *  read off a list of every one of them spelled out in full.
 *
 *  Pure. What the tags are is asked of the space (see `space_tags`), what a row
 *  looks like is TagTree.svelte's, and what a rename writes is tag-edits.ts. */

import type { Tag } from './workspace.svelte'

export interface TagNode {
  /** The last segment, which is what a row shows. */
  name: string
  /** The whole path from the root, which is what `tag:` asks for. */
  path: string
  /** Uses of this tag exactly, not counting the ones under it. */
  own: number
  /** Uses of this tag and of everything under it, which is the set `tag:path`
   *  finds and so the number a row shows. */
  total: number
  children: TagNode[]
}

/** The segments of a tag path, trimmed, with the empty ones dropped, so a tag
 *  somebody wrote as `#work/` or `#work//nib` still lands somewhere sensible and
 *  a name typed with a stray space is the name without it. */
function segmentsOf(tag: string): string[] {
  return tag
    .replace(/^#/, '')
    .split('/')
    .map((one) => one.trim())
    .filter((one) => one !== '')
}

/** The tags of a space as a tree, alphabetical at every level.
 *
 *  Folded, because the operator is: a note that wrote `#Work` and one that wrote
 *  `#work` are under one node, and a row that searched for one of them would
 *  otherwise find both and say the wrong number. The spelling shown is the first
 *  one the space offered, which for a list that arrives most-used first is the
 *  spelling most of the notes use. */
export function tagTree(tags: readonly Tag[]): TagNode[] {
  const roots: TagNode[] = []
  const byPath = new Map<string, TagNode>()

  for (const { tag, count } of tags) {
    const segments = segmentsOf(tag)
    if (!segments.length) continue

    let path = ''
    let siblings = roots

    for (const [depth, segment] of segments.entries()) {
      path = path ? `${path}/${segment.toLowerCase()}` : segment.toLowerCase()

      let node = byPath.get(path)
      if (!node) {
        node = { name: segment, path, own: 0, total: 0, children: [] }
        byPath.set(path, node)
        siblings.push(node)
      }

      // Every node on the way down holds the count too: that is what makes the
      // number on a row the number of notes the row's own search would find.
      node.total += count
      if (depth === segments.length - 1) node.own += count
      siblings = node.children
    }
  }

  sort(roots)
  return roots
}

/** Alphabetical, at every level, by what the row shows. A tree that reordered
 *  itself as counts changed would move under the hand about to click it. */
function sort(nodes: TagNode[]) {
  nodes.sort((a, b) => a.name.localeCompare(b.name))
  for (const node of nodes) sort(node.children)
}

/** Every node of the tree, depth first, which is the order the rows are in. */
export function nodesIn(nodes: readonly TagNode[]): TagNode[] {
  return nodes.flatMap((node) => [node, ...nodesIn(node.children)])
}

/** What `path` becomes when it is renamed to `name`: the same parent, the new
 *  last segment. A name with slashes in it moves the node, which is what
 *  dragging one would do and what typing one may as well. */
export function renamedTo(path: string, name: string): string | null {
  const wanted = segmentsOf(name).join('/').toLowerCase()
  if (!wanted) return null

  const segments = path.split('/')
  segments.pop()
  const moved = [...segments, wanted].join('/')

  // A node cannot be moved inside itself: every tag under it would be rewritten
  // to a path that is rewritten again, without end.
  if (moved === path || moved.startsWith(`${path}/`)) return null
  return moved
}

/** What `path` becomes when its node is taken away and what it held moves up one
 *  level. Null for a node already at the top, which has nowhere to move to and
 *  is only ever deleted. */
export function liftedFrom(path: string): string | null {
  const segments = path.split('/')
  segments.pop()
  return segments.length ? segments.join('/') : null
}
