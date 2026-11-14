import { nameFromTitle, shownName, samePath, joinPath } from '../platform/src/api'
import type { Entry, Space } from '../workspace.svelte'
import { UNTITLED } from '../workspace/documents.svelte'
import { writeFile } from '../workspace/write-file'
import { writeShortcut } from '@orden/scan/shortcut'

export interface Sites {
  readonly activeSpace: Space | null
  readonly device: { expand(folder: string): void }
  freeNameOnDisk(dir: string, wanted: string): Promise<string>
  showEntry(entry: Entry): void
  freshEntry(path: string, isFolder: boolean): Entry
}

export async function newSite(ws: Sites, dir: string, named?: string, url = ''): Promise<string> {
  const title = named === undefined ? UNTITLED : shownName(named)
  const path = joinPath(
    dir,
    await ws.freeNameOnDisk(dir, `${nameFromTitle(title) ?? UNTITLED}.url`),
  )

  ws.showEntry(ws.freshEntry(path, false))
  if (!samePath(dir, ws.activeSpace?.root)) ws.device.expand(dir)

  await writeFile(path, writeShortcut(url, title, new Date()))
  return path
}
