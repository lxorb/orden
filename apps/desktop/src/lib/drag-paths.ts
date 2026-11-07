import type { CarriedFiles } from '@orden/editor'
import type { Action } from 'svelte/action'
import type { Platform } from './keys'

const ONE = 'text/nib-path'
const MANY = 'text/nib-paths'
const BOOKMARK = 'text/nib-bookmark'
const SECTION = 'text/nib-section'
const TAB = 'text/nib-tab'
const EXPLORER = 'text/nib-explorer'
const PAGE = 'text/nib-page'
const HERE = `text/nib-from-${crypto.randomUUID()}`

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

export function carryFromExplorer(transfer: DataTransfer, paths: string[], inSpaces: boolean) {
  transfer.setData(EXPLORER, JSON.stringify(paths))
  transfer.setData('text/plain', paths.join('\n'))
  if (inSpaces) carry(transfer, paths)
  transfer.effectAllowed = 'copyMove'
  carrying = paths
}

export function carryOutside(transfer: DataTransfer, paths: readonly string[]) {
  transfer.setData(EXPLORER, JSON.stringify(paths))
  transfer.effectAllowed = 'copy'
  carrying = [...paths]
}

export function isExplorerDrag(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes(EXPLORER)
}

export function explorerDragged(transfer: DataTransfer | null): string[] {
  try {
    const said = transfer?.getData(EXPLORER) ?? ''
    const paths = JSON.parse(said === '' ? '[]' : said) as unknown
    if (Array.isArray(paths) && paths.every((one) => typeof one === 'string')) return paths
  } catch {
    return [...carrying]
  }
  return [...carrying]
}

export function isTreeDrag(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes(ONE)
}

export function mayCarryAddress(types: readonly string[]): boolean {
  if (types.includes('Files') || types.some((one) => one.startsWith('text/nib-'))) return false
  return types.includes('text/uri-list') || types.includes('text/plain')
}

export function outsideRows(transfer: DataTransfer | null): readonly string[] {
  if (!isExplorerDrag(transfer) || isTreeDrag(transfer)) return []

  const rows = explorerDragged(transfer)
  return rows.length ? rows : carrying
}

export function carriesFiles(transfer: DataTransfer | null): boolean {
  return !!transfer?.types.includes('Files') || outsideRows(transfer).length > 0
}

export const carriedFiles: CarriedFiles = {
  carries: (transfer) => outsideRows(transfer).length > 0,
  read(transfer) {
    const rows = outsideRows(transfer)
    if (!rows.length) return null
    return import('./outside-drops').then(({ filesAt }) => filesAt(rows))
  },
}

export const carriedIntoNotes: CarriedFiles = {
  carries: (transfer) => outsideRows(transfer).some((one) => !/\.pdf$/i.test(one)),
  read: (transfer) => (carriedIntoNotes.carries(transfer) ? carriedFiles.read(transfer) : null),
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
  if (isExplorerDrag(event.dataTransfer) && !isTreeDrag(event.dataTransfer)) return 'copy'
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

  carryHere(transfer, BOOKMARK, String(at))
  transfer.effectAllowed = 'move'
  carryingTile = tile
  carryingMark = at
}

let carryingMark: number | null = null

export function carriedMark(): number | null {
  return carryingMark
}

export function isBookmarkDrag(transfer: DataTransfer | null): boolean {
  return fromHere(transfer, BOOKMARK)
}

export function draggedBookmark(transfer: DataTransfer | null): number | null {
  return index(transfer, BOOKMARK)
}

export function carrySection(transfer: DataTransfer | null, at: number) {
  if (!transfer) return

  carryHere(transfer, SECTION, String(at))
  transfer.effectAllowed = 'move'
}

export function isSectionDrag(transfer: DataTransfer | null): boolean {
  return fromHere(transfer, SECTION)
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

export interface CarriedPage {
  note: string
  page: string
}

export function carryPage(transfer: DataTransfer | null, carried: CarriedPage) {
  if (!transfer) return

  carryHere(transfer, PAGE, JSON.stringify(carried))
  transfer.effectAllowed = 'move'
}

export function isPageDrag(transfer: DataTransfer | null): boolean {
  return fromHere(transfer, PAGE)
}

export function draggedPage(transfer: DataTransfer | null): CarriedPage | null {
  if (!transfer || !isPageDrag(transfer)) return null
  try {
    const said = JSON.parse(transfer.getData(PAGE)) as Partial<CarriedPage> | null
    return typeof said?.note === 'string' && typeof said.page === 'string'
      ? { note: said.note, page: said.page }
      : null
  } catch {
    return null
  }
}

function carryHere(transfer: DataTransfer, type: string, value: string) {
  transfer.setData(type, value)
  transfer.setData(HERE, type)
}

function fromHere(transfer: DataTransfer | null, type: string): boolean {
  const types = transfer?.types ?? []
  return types.includes(type) && types.includes(HERE)
}

function index(transfer: DataTransfer | null, type: string): number | null {
  if (!fromHere(transfer, type)) return null
  const written = transfer?.getData(type) ?? ''
  const at = Number(written)

  return written !== '' && Number.isInteger(at) && at >= 0 ? at : null
}

export type Over = (event: DragEvent) => unknown

export function listenOver(
  target: EventTarget,
  over: Over,
  options?: boolean | AddEventListenerOptions,
): () => void {
  const heard = over as EventListener
  target.addEventListener('dragenter', heard, options)
  target.addEventListener('dragover', heard, options)
  return () => {
    target.removeEventListener('dragenter', heard, options)
    target.removeEventListener('dragover', heard, options)
  }
}

type OverNode = (event: DragEvent & { currentTarget: HTMLElement }) => unknown

export const dropOver: Action<HTMLElement, OverNode> = (node, over) => {
  let current = over
  const stop = listenOver(node, (event) =>
    current(event as DragEvent & { currentTarget: HTMLElement }),
  )
  return {
    update(next: OverNode) {
      current = next
    },
    destroy: stop,
  }
}
