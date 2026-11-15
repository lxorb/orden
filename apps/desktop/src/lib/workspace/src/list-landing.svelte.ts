import { portOf } from '@orden/contracts'
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
import { within } from '../../platform/src/api'
import { workspace } from './workspace.svelte'

class FileClipboard {
  paths = $state<string[]>([])
  cut = $state(false)

  private readonly cutting = $derived(new Set(this.cut ? this.paths : []))

  hold(paths: readonly string[], cut: boolean) {
    this.paths = [...paths]
    this.cut = cut
  }

  isCut(path: string): boolean {
    return this.cutting.has(path)
  }

  async paste(into: string) {
    const paths = this.paths.filter((one) => workspace.entryAt(one) !== null)
    const outside = this.paths.filter(
      (one) => !workspace.spaces.some((space) => within(space.root, one) !== null),
    )
    const explorer = portOf('explorer.carry')
    if (outside.length && explorer.ok) {
      const cut = this.cut
      if (cut) this.hold([], false)
      return explorer.value.carry(this.paths, into, cut ? 'move' : 'copy')
    }
    if (!paths.length) return
    if (!this.cut) return workspace.copyMany(paths, into)

    this.hold([], false)
    return workspace.moveMany(paths, into)
  }
}

export const fileClipboard = new FileClipboard()

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
    void sites.value.dropped(
      folder,
      transfer.getData('text/uri-list'),
      transfer.getData('text/html'),
    )
    return
  }

  const tile = landing(event, currentPlatform()) && isBookmarkDrag(transfer)
  const at = tile ? workspace.bookmarks.indexOf(draggedBookmark(transfer)) : null
  if (at !== null) {
    void import('../../essentials.svelte').then((one) => one.unkeepInto(at, folder))
    return
  }

  const paths = dragged(transfer)
  if (!paths.length) return

  if (landing(event, currentPlatform()) === 'copy') void workspace.copyMany(paths, folder)
  else void workspace.moveMany(paths, folder)
}
