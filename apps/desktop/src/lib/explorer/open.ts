import { fileMark } from '../file-mark'
import { t } from '../i18n.svelte'
import { within } from '../space-paths'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
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
    at ? folderName(at) : t('File explorer'),
    null,
    activate,
  )
}

export function ordenOpens(name: string): boolean {
  const mark = fileMark(name)
  return mark !== 'file' && mark !== 'picture'
}

export function inASpace(path: string): boolean {
  return workspace.spaces.some((space) => within(space.root, path) !== null)
}

export async function openFile(path: string, name: string) {
  if (inASpace(path) && ordenOpens(name)) await workspace.openEntry(path)
  else await openWithSystem(path)
}
