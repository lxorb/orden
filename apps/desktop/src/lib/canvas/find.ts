import type { Canvas } from './format'

export interface Found {
  id: string
  says: string
  paper?: number
}

const SHOWN = 60

function flattened(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function shortened(flat: string, term: string): string {
  if (flat.length <= SHOWN) return flat

  const at = flat.toLowerCase().indexOf(term)
  if (at < 0) return `${flat.slice(0, SHOWN)}…`

  const from = Math.max(0, at - 20)
  return `${from ? '…' : ''}${flat.slice(from, from + SHOWN)}…`
}

export function matches(canvas: Canvas, term: string): Found[] {
  const wanted = flattened(term).toLowerCase()
  if (!wanted) return []

  const found: Found[] = []
  const meet = (id: string, text: string) => {
    const flat = flattened(text)
    if (flat.toLowerCase().includes(wanted)) found.push({ id, says: shortened(flat, wanted) })
  }

  for (const node of canvas.nodes) meet(node.id, saysOf(node))
  for (const edge of canvas.edges) if (edge.label) meet(edge.id, edge.label)

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
