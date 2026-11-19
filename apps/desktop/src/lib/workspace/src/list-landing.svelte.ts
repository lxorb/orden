import { type Entry, portOf } from '@orden/contracts'
import {
  caughtFiles,
  dragged,
  draggedBookmark,
  explorerDragged,
  isBookmarkDrag,
  isExplorerDrag,
  isFileDrop,
  isLinkDrop,
  isTreeDrag,
  currentPlatform,
  landing,
} from '../../ui-kit/src/api'
import { keeping } from '../../file-ops/src/api'
import { movedTo, nameOf, spaceHolding } from '../../platform/src/api'
import { workspace } from './workspace.svelte'

class FileClipboard {
  paths = $state<string[]>([])
  cut = $state(false)
  private readonly cutting = $derived(new Set(this.cut ? this.paths : []))
  private held = new Map<string, Entry>()
  hold(paths: readonly string[], cut: boolean) {
    this.paths = [...paths]
    this.cut = cut
    this.held = new Map(
      paths.flatMap((path) => {
        const entry = workspace.entryAt(path)
        return entry ? [[path, entry] as const] : []
      }),
    )
  }
  isCut(path: string): boolean {
    return this.cutting.has(path)
  }
  moved(from: string, to: string) {
    const now = this.paths.map((path) => movedTo(path, from, to) ?? path)
    if (!now.some((path, at) => path !== this.paths[at])) return
    this.held = new Map(
      [...this.held].map(([path, entry]) => {
        const there = movedTo(path, from, to)
        return there === null ? [path, entry] : [there, { ...entry, path: there, name: nameOf(there), children: [] }]
      }),
    )
    this.paths = now
  }
  spaceMoved(from: string, to: string) {
    this.moved(from, to)
  }
  gone(path: string) {
    const kept = this.paths.filter((one) => movedTo(one, path, path) === null)
    if (kept.length === this.paths.length) return
    for (const one of this.held.keys()) if (movedTo(one, path, path) !== null) this.held.delete(one)
    this.paths = kept
  }
  async paste(into: string) {
    const inSpace = (one: string) => spaceHolding(workspace.spaces, one) !== null
    const outside = this.paths.filter((one) => !inSpace(one))
    const explorer = portOf('explorer.carry')
    if (outside.length && explorer.ok) {
      const cut = this.cut
      if (cut) this.hold([], false)
      return explorer.value.carry(this.paths, into, cut ? 'move' : 'copy')
    }
    const away = this.paths.flatMap((one) => {
      const entry = workspace.entryAt(one) === null && inSpace(one) ? this.held.get(one) : undefined
      return entry ? [entry] : []
    })
    const paths = this.paths.filter(
      (one) => workspace.entryAt(one) !== null || away.some((entry) => entry.path === one),
    )
    if (!paths.length) return
    if (!this.cut) return workspace.carrying(away, () => workspace.copyMany(paths, into))
    this.hold([], false)
    return workspace.carrying(away, () => workspace.moveMany(paths, into))
  }
}
export const fileClipboard = new FileClipboard()
workspace.fileOps.follow(keeping(fileClipboard))
export const listMotion: {
  before: () => Map<string, number> | null
  after: (was: Map<string, number> | null) => void
} = { before: () => null, after: () => undefined }
export function moving(change: () => void): void {
  const was = listMotion.before()
  change()
  listMotion.after(was)
}
export function dropOnList(event: DragEvent, folder: string) {
  const transfer = event.dataTransfer
  const explorer = portOf('explorer.carry')
  if (transfer && isExplorerDrag(transfer) && !isTreeDrag(transfer) && explorer.ok) {
    void explorer.value.carry(explorerDragged(transfer), folder, 'copy')
    return
  }
  if (transfer && isFileDrop(transfer) && !__EVEN_PLUGIN__) {
    const caught = caughtFiles(transfer)
    void import('../../ui-controls/src/api')
      .then(({ filesUnder }) => filesUnder(caught))
      .then((files) => workspace.bringIn(files, folder))
    return
  }
  const sites = portOf('web.sites')
  if (transfer && isLinkDrop(transfer) && sites.ok) {
    void sites.value.dropped(folder, transfer.getData('text/uri-list'), transfer.getData('text/html'))
    return
  }
  const tile = landing(event, currentPlatform()) && isBookmarkDrag(transfer)
  const at = tile ? workspace.bookmarks.indexOf(draggedBookmark(transfer)) : null
  if (at !== null) {
    void import('./essentials.svelte').then((one) => one.unkeepInto(at, folder))
    return
  }
  const paths = dragged(transfer)
  if (!paths.length) return
  if (landing(event, currentPlatform()) === 'copy') void workspace.copyMany(paths, folder)
  else void workspace.moveMany(paths, folder)
}
