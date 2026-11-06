import type { Canvas } from './format'

export interface Found {
  id: string
  says: string
}

const SHOWN = 60

function shortened(text: string, term: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= SHOWN) return flat

  const at = flat.toLowerCase().indexOf(term.toLowerCase())
  if (at < 0) return `${flat.slice(0, SHOWN)}…`

  const from = Math.max(0, at - 20)
  return `${from ? '…' : ''}${flat.slice(from, from + SHOWN)}…`
}

export function matches(canvas: Canvas, term: string): Found[] {
  const wanted = term.trim().toLowerCase()
  if (!wanted) return []

  const found: Found[] = []

  for (const node of canvas.nodes) {
    const says = saysOf(node)
    if (says.toLowerCase().includes(wanted)) {
      found.push({ id: node.id, says: shortened(says, wanted) })
    }
  }

  for (const edge of canvas.edges) {
    if (edge.label?.toLowerCase().includes(wanted)) {
      found.push({ id: edge.id, says: shortened(edge.label, wanted) })
    }
  }

  return found
}

function saysOf(node: Canvas['nodes'][number]): string {
  switch (node.type) {
    case 'text':
      return node.text
    case 'file':
      return node.file
    case 'link':
      return node.url
    case 'group':
      return node.label ?? ''
    case 'shape':
      return node.text ?? ''
    case 'page':
      return ''
  }
}
