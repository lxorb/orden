import { fileMark } from '../../file-mark'
import { nameOf, within } from '../../platform/src/api'
import type { Tab } from '../../workspace/documents.svelte'
import { workspace } from '../../workspace.svelte'
import { openWithSystem } from './commands'
import { folderName } from './crumbs'
import { places } from './places.svelte'
import { writeSpec } from './spec'

export async function openExplorer(folder?: string, activate = true): Promise<Tab> {
  const at = folder ?? (await places.home())
  const words = at ? writeSpec({ folder: at, back: [], ahead: [] }) : ''
  return workspace.openUnsaved(
    'explorer',
    words,
    at ? folderName(at) : 'File explorer',
    null,
    activate,
  )
}

export function ordenOpens(path: string): boolean {
  if (!inASpace(path)) return false
  const mark = fileMark(nameOf(path))
  return mark !== 'file' && mark !== 'picture'
}

export function inASpace(path: string): boolean {
  return workspace.spaces.some((space) => within(space.root, path) !== null)
}

export async function openFile(path: string) {
  if (ordenOpens(path)) await workspace.openEntry(path)
  else await openWithSystem(path)
}
