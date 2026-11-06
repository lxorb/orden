import { answer, method } from './mobile/bridge'

export interface Edges {
  top: number
  right: number
  bottom: number
  left: number
}

const EDGES = ['top', 'right', 'bottom', 'left'] as const

export function edgesOf(text: string): Edges | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null

  const read: Record<string, unknown> = { ...parsed }
  const edges: Edges = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const edge of EDGES) {
    const value = read[edge]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
    edges[edge] = value
  }

  return edges
}

export function writeEdges(root: HTMLElement, edges: Edges): void {
  for (const edge of EDGES) root.style.setProperty(`--inset-${edge}`, `${edges[edge]}px`)
}

export function startInsets(): void {
  const insets = method('insets')
  if (!insets) return

  const read = () => {
    const edges = edgesOf(insets())
    if (edges) writeEdges(document.documentElement, edges)
  }

  read()
  answer('__nibInsets', read)
}

export function tintSystemBars(dark: boolean): void {
  method('bars')?.(dark)
}
