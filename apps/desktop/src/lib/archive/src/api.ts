import type { FileAction } from '../../file-undo/src/api'

type Archiving = Extract<FileAction, { kind: 'archive' | 'unarchive' }>

export const loadArchive = () => import('./Archive.svelte')

export const loadArchivedStrip = () => import('./ArchivedStrip.svelte')

export const archive = async (paths: readonly string[]): Promise<void> => {
  await (await import('./archiving')).archive(paths)
}

export const unarchive = async (path: string): Promise<void> => {
  await (await import('./archiving')).unarchive(path)
}

export const archiveAgain = async (action: Archiving): Promise<void> => {
  await (await import('./archiving')).archiveAgain(action)
}

export const showArchive = async (path: string | null = null): Promise<void> => {
  ;(await import('./archive-list.svelte')).archiveList.show(path)
}
