import { toBase64 } from '../bytes'
import {
  caughtFiles,
  carriedNothing,
  carryFromExplorer,
  dragged,
  explorerDragged,
  isExplorerDrag,
  isFileDrop,
  isTreeDrag,
} from '../drag-paths'
import { message } from '../i18n.svelte'
import type { Picked } from '../import/sources'
import { invoke, isDesktop, joinPath, platform } from '../tauri'
import { workspace } from '../workspace.svelte'
import type { OutsideStep } from '../workspace/undo.svelte'
import { carry, changeable, freeName } from './changes'
import { listFolder } from './commands'
import { inASpace } from './open'
import type { ExplorerView } from './view.svelte'

export function startDrag(event: DragEvent, paths: string[]) {
  if (!event.dataTransfer || !paths.length) return
  carryFromExplorer(
    event.dataTransfer,
    paths,
    paths.every((one) => inASpace(one)),
  )
  if (isDesktop) void import('../web-tab/carry-in').then((pages) => pages.carryToPages(paths))
}

export function endDrag() {
  if (isDesktop) void import('../web-tab/carry-in').then((pages) => pages.carriedToPages())
  carriedNothing()
}

function takes(transfer: DataTransfer | null): boolean {
  return isExplorerDrag(transfer) || isTreeDrag(transfer) || isFileDrop(transfer)
}

export function dropHow(event: DragEvent): 'copy' | 'move' {
  const copying = platform() === 'macos' ? event.altKey : event.ctrlKey
  if (copying) return 'copy'
  if (event.shiftKey) return 'move'
  return isExplorerDrag(event.dataTransfer) && !isTreeDrag(event.dataTransfer) ? 'move' : 'copy'
}

export function over(event: DragEvent): boolean {
  if (!takes(event.dataTransfer)) return false
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = dropHow(event)
  return true
}

export function dropInto(view: ExplorerView, event: DragEvent, folder: string) {
  const transfer = event.dataTransfer
  if (!transfer || !takes(transfer)) return
  event.preventDefault()
  const how = dropHow(event)
  if (isFileDrop(transfer)) {
    const caught = caughtFiles(transfer)
    void import('../import/picking')
      .then(({ filesUnder }) => filesUnder(caught))
      .then((files) => writeInto(view, files, folder))
    return
  }
  const paths = isExplorerDrag(transfer) ? explorerDragged(transfer) : dragged(transfer)
  carriedNothing()
  if (paths.length) void carry(view, paths, folder, how)
}

async function writeInto(view: ExplorerView, files: readonly Picked[], folder: string) {
  if (!files.length || !changeable(view)) return
  if (inASpace(folder)) {
    await workspace.bringIn(files, folder)
    await view.reload()
    return
  }
  const listing = await listFolder(folder).catch(() => null)
  if (!listing) return
  const taken = listing.entries.map((one) => one.name)
  const tops = new Map<string, string>()
  try {
    for (const file of files) {
      const [top = file.name, ...rest] = (
        file.webkitRelativePath?.length ? file.webkitRelativePath : file.name
      ).split('/')
      let name = tops.get(top)
      if (name === undefined) {
        name = freeName(taken, top)
        taken.push(name)
        tops.set(top, name)
      }
      const bytes = toBase64(new Uint8Array(await file.arrayBuffer()))
      await invoke('explorer_write', { folder, under: [name, ...rest].join('/'), bytes })
    }
  } catch (error) {
    view.tell(message(error, 'could not copy this'))
  }
  const steps: OutsideStep[] = [...tops.values()].map((name) => ({
    op: 'made',
    path: joinPath(listing.path, name),
  }))
  if (steps.length) workspace.undone.record({ kind: 'outside', steps })
  await view.reload()
}
