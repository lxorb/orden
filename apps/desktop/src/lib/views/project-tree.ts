/** The projects the Tasks panel lists, Todoist's "My Projects" the nib way: the notes in
 *  the space's projects folder, as the file list draws them (docs/tree.md). A note is a
 *  project, a folder is a project whose note is its namesake (`Uni/Uni.md`, written or
 *  not yet), and what a folder holds besides its own note are its sub-projects. The order
 *  is the file list's own Manual order, which the account keeps for every device, so a
 *  project dragged in the panel is dragged in the file list and the other way round.
 *
 *  Each project carries how many open tasks its note holds. Notes with open tasks that
 *  live anywhere else are the panel's Notes, every one of them, so a task written in a
 *  meeting note is never out of sight.
 *
 *  Pure: the folder's listing, the arranged names and the counts in, the rows out. */

import { folderNote, folderNotePath, nestedIn } from '../folder-notes'
import { isMarkdownPath, withoutExtension } from '../space-paths'
import { ordered } from '../tree-order'
import type { Entry } from '../workspace.svelte'

export interface ProjectNode {
  /** The note, on this disk: a folder's namesake, written or not. */
  note: string
  /** The folder it is drawn as, for one that is one. */
  folder: string | null
  name: string
  depth: number
  /** Open tasks in its own note. */
  count: number
  children: ProjectNode[]
}

/** The projects under a folder, in the file list's order, however deep. `count` is asked
 *  for a note's open tasks by its path on this disk. */
export function projectNodes(
  folder: Entry,
  listOf: (folder: string) => readonly string[],
  count: (note: string) => number,
  depth = 0,
): ProjectNode[] {
  const out: ProjectNode[] = []
  for (const child of ordered(nestedIn(folder), 'manual', listOf(folder.path))) {
    if (child.is_dir) {
      const note = folderNote(child)?.path ?? folderNotePath(child.path)
      out.push({
        note,
        folder: child.path,
        name: child.name,
        depth,
        count: count(note),
        children: projectNodes(child, listOf, count, depth + 1),
      })
    } else if (isMarkdownPath(child.name)) {
      out.push({
        note: child.path,
        folder: null,
        name: withoutExtension(child.name),
        depth,
        count: count(child.path),
        children: [],
      })
    }
  }
  return out
}

/** The tree as the rows the panel draws, a folded project's sub-projects left out. */
export function projectRows(
  nodes: readonly ProjectNode[],
  folded: ReadonlySet<string>,
): ProjectNode[] {
  const out: ProjectNode[] = []
  const walk = (list: readonly ProjectNode[]) => {
    for (const node of list) {
      out.push(node)
      if (!folded.has(node.note)) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/** Every note the tree holds, for telling the panel's Notes from its projects. */
export function projectNotes(nodes: readonly ProjectNode[]): string[] {
  return nodes.flatMap((node) => [node.note, ...projectNotes(node.children)])
}
