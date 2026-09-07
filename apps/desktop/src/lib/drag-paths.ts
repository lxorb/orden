/** What a drag in the file list carries.
 *
 *  Out of the tree: one row, or the whole selection when the row dragged is
 *  part of it. The single path travels alongside the list, so every target
 *  keeps recognising a tree drag by the type it always had.
 *
 *  Within the bookmarks: which row is moving, by its place in the list. Its own
 *  type, so a bookmark dragged over the tree is not read as a note to move and
 *  a note dropped on the bookmarks does not reorder them. */

const ONE = 'text/nib-path'
const MANY = 'text/nib-paths'
const BOOKMARK = 'text/nib-bookmark'

export function carry(transfer: DataTransfer | null, paths: string[]) {
  const [first] = paths
  if (!transfer || !first) return
  transfer.setData(ONE, first)
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

export function carryBookmark(transfer: DataTransfer | null, at: number) {
  if (!transfer) return

  transfer.setData(BOOKMARK, String(at))
  transfer.effectAllowed = 'move'
}

export function isBookmarkDrag(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes(BOOKMARK)
}

/** Which row is being dragged, or null when the drag is not a bookmark's. The
 *  index travels as text, so anything that is not a whole number is not ours. */
export function draggedBookmark(transfer: DataTransfer | null): number | null {
  const written = transfer?.getData(BOOKMARK) ?? ''
  const at = Number(written)

  return written !== '' && Number.isInteger(at) && at >= 0 ? at : null
}
