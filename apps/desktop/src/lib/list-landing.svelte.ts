import { siteDropping } from './web-tab/src/api'
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
  landing,
} from './drag-paths'
import { shortcuts } from './shortcuts.svelte'
import { within } from './platform/src/api'
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
    if (outside.length && !__EVEN_PLUGIN__) {
      const cut = this.cut
      if (cut) this.hold([], false)
      const { carry } = await import('./explorer/src/api')
      return carry(null, this.paths, into, cut ? 'move' : 'copy')
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
  if (transfer && isExplorerDrag(transfer) && !isTreeDrag(transfer) && !__EVEN_PLUGIN__) {
    const paths = explorerDragged(transfer)
    void import('./explorer/src/api').then(({ carry }) => carry(null, paths, folder, 'copy'))
    return
  }
  if (transfer && isFileDrop(transfer) && !__EVEN_PLUGIN__) {
    const caught = caughtFiles(transfer)
    void import('./picking')
      .then(({ filesUnder }) => filesUnder(caught))
      .then((files) => workspace.bringIn(files, folder))
    return
  }

  if (transfer && isLinkDrop(transfer) && !__EVEN_PLUGIN__) {
    const list = transfer.getData('text/uri-list')
    const html = transfer.getData('text/html')
    void siteDropping().then(({ siteDropped }) => siteDropped(workspace, folder, list, html))
    return
  }

  const tile = landing(event, shortcuts.platform) && isBookmarkDrag(transfer)
  const at = tile ? workspace.bookmarks.indexOf(draggedBookmark(transfer)) : null
  if (at !== null) {
    void import('./essentials.svelte').then((one) => one.unkeepInto(at, folder))
    return
  }

  const paths = dragged(transfer)
  if (!paths.length) return

  if (landing(event, shortcuts.platform) === 'copy') void workspace.copyMany(paths, folder)
  else void workspace.moveMany(paths, folder)
}
