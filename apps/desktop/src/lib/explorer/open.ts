import { fileMark } from '../file-mark'
import { t } from '../i18n.svelte'
import { nameOf, within } from '../space-paths'
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

export type Opening = 'orden' | 'look' | 'system'

export function openingOf(path: string): Opening {
  const mark = fileMark(nameOf(path))
  if (mark === 'picture') return 'look'
  return mark !== 'file' && inASpace(path) ? 'orden' : 'system'
}

export function ordenOpens(path: string): boolean {
  return openingOf(path) !== 'system'
}

export function inASpace(path: string): boolean {
  return workspace.spaces.some((space) => within(space.root, path) !== null)
}

export async function openFile(path: string, look: () => void) {
  const opening = openingOf(path)
  if (opening === 'look') look()
  else if (opening === 'orden') await workspace.openEntry(path)
  else await openWithSystem(path)
}
