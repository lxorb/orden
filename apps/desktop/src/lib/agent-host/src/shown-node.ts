import type { CanvasNode } from '@orden/markdown/canvas'

type TextCard = CanvasNode & { type: 'text' }
export type ShownNode = Exclude<CanvasNode, TextCard> | (Omit<TextCard, 'size'> & { fontSize?: number })
export function shown(node: CanvasNode): ShownNode {
  if (node.type !== 'text' || node.size === undefined) return node
  const { size, ...rest } = node
  return { ...rest, fontSize: size }
}
