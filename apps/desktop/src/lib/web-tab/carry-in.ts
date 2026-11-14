import { isWebTarget } from '@orden/markdown/links'
import { readWebFile } from '@orden/scan/shortcut'
import { isExplorerDrag, isTreeDrag } from '../drag-paths'
import { invoke, isDesktop } from '../platform/src/api'
import { workspace } from '../workspace.svelte'
import { zoneAt } from '../workspace/zones'

export interface Carrying {
  files: string[]
  addresses: string[]
}

export interface Looking {
  isFolder: (path: string) => boolean
  locked: (path: string) => boolean
  read: (path: string) => Promise<string | null>
}

export async function carryingOf(paths: readonly string[], look: Looking): Promise<Carrying> {
  const files: string[] = []
  const addresses: string[] = []
  for (const path of paths) {
    if (look.isFolder(path) || look.locked(path)) continue
    if (!isWebTarget(path)) {
      files.push(path)
      continue
    }
    const url = readWebFile(path, await look.read(path))?.url
    if (url) addresses.push(url)
  }
  return { files, addresses }
}

const looking: Looking = {
  isFolder: (path) => workspace.entryAt(path)?.is_dir ?? false,
  locked: (path) => workspace.protection.locked(path),
  read: (path) => invoke<string>('read_note', { path }).catch(() => null),
}

let line: Promise<unknown> = Promise.resolve()
let told = false
let waiting: { tab: string; x: number; y: number } | null = null
let overOn: string | null = null

function next(step: () => Promise<unknown>): void {
  line = line.then(step).catch(() => undefined)
}

export function carryToPages(paths: readonly string[], look: Looking = looking): void {
  if (!isDesktop || __EVEN_PLUGIN__) return
  told = false
  next(async () => {
    const carrying = await carryingOf(paths, look)
    if (!carrying.files.length && !carrying.addresses.length) return
    const { diskPathOf } = await import('../internal/work')
    carrying.files = await Promise.all(carrying.files.map(diskPathOf))
    told = (await invoke<boolean | null>('page_carry', { ...carrying })) ?? false
  })
}

export function carriedToPages(): void {
  if (!isDesktop) return
  waiting = null
  overOn = null
  next(async () => {
    told = false
    await invoke('page_carry_end')
  })
}

function tell(tab: string, phase: 'over' | 'leave' | 'drop', x: number, y: number): void {
  overOn = phase === 'over' ? tab : null
  if (phase === 'over') {
    const queued = waiting !== null
    waiting = { tab, x, y }
    if (queued) return
    next(async () => {
      const at = waiting
      waiting = null
      if (at && told) await invoke('page_carry_over', { ...at, phase })
    })
    return
  }
  waiting = null
  next(async () => {
    if (told) await invoke('page_carry_over', { tab, phase, x, y })
  })
}

function inMiddle(hole: HTMLElement, event: DragEvent): boolean {
  const pane = hole.closest<HTMLElement>('[data-pane]')
  const id = pane?.dataset.pane
  if (!pane || !id) return true
  const zone = zoneAt(pane.getBoundingClientRect(), event.clientX, event.clientY, (side) =>
    workspace.canLand(side, id, null),
  )
  return zone === 'middle'
}

function pointOf(hole: HTMLElement, event: DragEvent, zoom: number) {
  const box = hole.getBoundingClientRect()
  const by = zoom > 0 ? zoom : 1
  return { x: (event.clientX - box.left) / by, y: (event.clientY - box.top) / by }
}

function carried(event: DragEvent): boolean {
  return isDesktop && (isTreeDrag(event.dataTransfer) || isExplorerDrag(event.dataTransfer))
}

export function overPage(tab: string, hole: HTMLElement, event: DragEvent, zoom: number): void {
  if (!carried(event)) return
  if (!told || !inMiddle(hole, event)) {
    leftPage(tab)
    return
  }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  const at = pointOf(hole, event, zoom)
  tell(tab, 'over', at.x, at.y)
}

export function leftPage(tab: string): void {
  if (overOn === tab) tell(tab, 'leave', 0, 0)
}

export function droppedOnPage(
  tab: string,
  hole: HTMLElement,
  event: DragEvent,
  zoom: number,
): void {
  if (!carried(event) || !told || !inMiddle(hole, event)) return
  event.preventDefault()
  const at = pointOf(hole, event, zoom)
  tell(tab, 'drop', at.x, at.y)
}
