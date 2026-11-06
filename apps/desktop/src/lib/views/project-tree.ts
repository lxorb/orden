import { folderNote, folderNotePath, nestedIn } from '../folder-notes'
import { isMarkdownPath, withoutExtension } from '../space-paths'
import { ordered } from '../tree-order'
import type { Entry } from '../workspace.svelte'

export interface ProjectNode {
  note: string
  folder: string | null
  name: string
  depth: number
  count: number
  children: ProjectNode[]
}

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

export function projectNotes(nodes: readonly ProjectNode[]): string[] {
  return nodes.flatMap((node) => [node.note, ...projectNotes(node.children)])
}
