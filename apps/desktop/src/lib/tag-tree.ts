/** A space's tags as the tree their slashes already describe.
 *
 *  `work/nib/canvas` is a path, the way Obsidian and Notable read one: a note
 *  tagged with it is a note under `work/nib` and under `work` as well, to any
 *  depth. The `tag:` operator has always read the slashes that way; this is the
 *  same fact drawn, so a space can be looked through by its tags rather than
 *  read off a list of every one of them spelled out in full.
 *
 *  Pure, and an assembler rather than a counter: the counting is `spaceTags` in
 *  link-index.svelte.ts, which already answers a row per level because the editor's
 *  `#` popup wants the same numbers. What a row looks like is TagTree.svelte's, and
 *  what a rename writes is tag-edits.ts. */

import type { SpaceTag } from '@nib/editor'

export interface TagNode {
  /** The last segment, which is what a row shows. */
  name: string
  /** The whole path from the root, which is what `tag:` asks for. */
  path: string
  /** How many notes this row's own search would find: the notes carrying this tag
   *  or anything under it, each counted once. Whoever counted them already rolled
   *  the levels up; see `spaceTags`. */
  notes: number
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
 *  otherwise find both and say the wrong number.
 *
 *  The list holds a row per level already - `work` as well as `work/nib` - so this
 *  hangs each one where its path says and takes its number as given. Adding them up
 *  again here would count a note twice for every level it is under. A level the list
 *  does not mention is still made, as a parent with nothing of its own to say, so a
 *  gap in the list cannot lose the branch under it. */
export function tagTree(tags: readonly SpaceTag[]): TagNode[] {
  const roots: TagNode[] = []
  const byPath = new Map<string, TagNode>()

  const make = (segments: readonly string[]): TagNode | null => {
    let path = ''
    let siblings = roots
    let node: TagNode | null = null

    for (const segment of segments) {
      path = path ? `${path}/${segment.toLowerCase()}` : segment.toLowerCase()

      let held = byPath.get(path)
      if (!held) {
        held = { name: segment, path, notes: 0, children: [] }
        byPath.set(path, held)
        siblings.push(held)
      }

      node = held
      siblings = held.children
    }

    return node
  }

  for (const { tag, notes } of tags) {
    const segments = segmentsOf(tag)
    if (!segments.length) continue

    const node = make(segments)
    // Added rather than set, so two spellings of one path land on one row with both
    // their notes. Adding a row into the levels *above* it is the thing this must not
    // do - that is what would count a note once per level it is under.
    if (node) node.notes += notes
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
