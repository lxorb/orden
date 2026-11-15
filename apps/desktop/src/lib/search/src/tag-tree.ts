import type { SpaceTag } from '@orden/editor'

export interface TagNode {
  name: string
  path: string
  notes: number
  children: TagNode[]
}

function segmentsOf(tag: string): string[] {
  return tag
    .replace(/^#/, '')
    .split('/')
    .map((one) => one.trim())
    .filter((one) => one !== '')
}

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
    if (node) node.notes += notes
  }

  sort(roots)
  return roots
}

function sort(nodes: TagNode[]) {
  nodes.sort((a, b) => a.name.localeCompare(b.name))
  for (const node of nodes) sort(node.children)
}

export function nodesIn(nodes: readonly TagNode[]): TagNode[] {
  return nodes.flatMap((node) => [node, ...nodesIn(node.children)])
}

export function renamedTo(path: string, name: string): string | null {
  const wanted = segmentsOf(name).join('/').toLowerCase()
  if (!wanted) return null

  const segments = path.split('/')
  segments.pop()
  const moved = [...segments, wanted].join('/')

  if (moved === path || moved.startsWith(`${path}/`)) return null
  return moved
}

export function liftedFrom(path: string): string | null {
  const segments = path.split('/')
  segments.pop()
  return segments.length ? segments.join('/') : null
}
