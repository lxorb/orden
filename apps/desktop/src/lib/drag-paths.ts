/** What a drag out of the tree carries: one row, or the whole selection when
 *  the row dragged is part of it. The single path travels alongside the list,
 *  so every target keeps recognising a tree drag by the type it always had. */

const ONE = 'text/nib-path'
const MANY = 'text/nib-paths'

export function carry(transfer: DataTransfer | null, paths: string[]) {
  if (!transfer || !paths.length) return
  transfer.setData(ONE, paths[0])
  transfer.setData(MANY, JSON.stringify(paths))
  transfer.effectAllowed = 'move'
}

export function isTreeDrag(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes(ONE)
}

export function dragged(transfer: DataTransfer | null): string[] {
  if (!transfer) return []
  try {
    const many = JSON.parse(transfer.getData(MANY) || '[]') as unknown
    if (Array.isArray(many) && many.every((one) => typeof one === 'string') && many.length) {
      return many
    }
  } catch {
    // Not from the tree, or from an older build: the single path below.
  }
  const one = transfer.getData(ONE)
  return one ? [one] : []
}
