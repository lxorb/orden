import type { Platform } from './keys'

const ONE = 'text/nib-path'
const MANY = 'text/nib-paths'
const BOOKMARK = 'text/nib-bookmark'
const SECTION = 'text/nib-section'
const TAB = 'text/nib-tab'

let carrying: readonly string[] = []

export function carry(transfer: DataTransfer | null, paths: string[]) {
  const [first] = paths
  if (!transfer || !first) return
  transfer.setData(ONE, first)
  transfer.setData(MANY, JSON.stringify(paths))
  transfer.effectAllowed = 'copyMove'
  carrying = paths
}

export function carried(): readonly string[] {
  return carrying
}

export function carriedNothing() {
  carrying = []
  carryingTile = false
  carryingMark = null
}

export function isTreeDrag(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes(ONE)
}

export function mayCarryAddress(types: readonly string[]): boolean {
  if (types.includes('Files') || types.some((one) => one.startsWith('text/nib-'))) return false
  return types.includes('text/uri-list') || types.includes('text/plain')
}

export function isFileDrop(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes('Files') && !isTreeDrag(transfer)
}

export function isLinkDrop(transfer: DataTransfer | null): boolean {
  const types = transfer?.types ?? []
  return types.includes('text/uri-list') && mayCarryAddress(types) && !isTreeDrag(transfer)
}

export interface CaughtFiles {
  entries: FileSystemEntry[]
  loose: File[]
}

export function caughtFiles(transfer: DataTransfer): CaughtFiles {
  const entries = [...transfer.items]
    .filter((one) => one.kind === 'file')
    .map((one) => one.webkitGetAsEntry())
    .filter((one): one is FileSystemEntry => !!one)

  return { entries, loose: [...transfer.files] }
}

export function landing(
  event: Pick<DragEvent, 'dataTransfer' | 'ctrlKey' | 'altKey'>,
  platform: Platform,
): 'move' | 'copy' | null {
  if (isFileDrop(event.dataTransfer) || isLinkDrop(event.dataTransfer)) return 'copy'
  if (carryingTile && isBookmarkDrag(event.dataTransfer)) return 'move'
  if (!isTreeDrag(event.dataTransfer)) return null

  return (platform === 'mac' ? event.altKey : event.ctrlKey) ? 'copy' : 'move'
}

export function carriedRows(transfer: DataTransfer | null): readonly string[] {
  if (!isTreeDrag(transfer)) return []

  const rows = dragged(transfer)
  return rows.length ? rows : carrying
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

let carryingTile = false

export function carryBookmark(transfer: DataTransfer | null, at: number, tile = false) {
  if (!transfer) return

  transfer.setData(BOOKMARK, String(at))
  transfer.effectAllowed = 'move'
  carryingTile = tile
  carryingMark = at
}

let carryingMark: number | null = null

export function carriedMark(): number | null {
  return carryingMark
}

export function isBookmarkDrag(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes(BOOKMARK)
}

export function draggedBookmark(transfer: DataTransfer | null): number | null {
  return index(transfer, BOOKMARK)
}

export function carrySection(transfer: DataTransfer | null, at: number) {
  if (!transfer) return

  transfer.setData(SECTION, String(at))
  transfer.effectAllowed = 'move'
}

export function isSectionDrag(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes(SECTION)
}

export function draggedSection(transfer: DataTransfer | null): number | null {
  return index(transfer, SECTION)
}

export function carryTab(transfer: DataTransfer, id: string) {
  transfer.setData(TAB, id)
}

export function draggedTab(transfer: DataTransfer | null): string | undefined {
  return transfer?.getData(TAB)
}

function index(transfer: DataTransfer | null, type: string): number | null {
  const written = transfer?.getData(type) ?? ''
  const at = Number(written)

  return written !== '' && Number.isInteger(at) && at >= 0 ? at : null
}
