import type { Version } from './versions'

export { recovery, STORAGE_KEY as RECOVERY_KEY } from './recovery.svelte'
export type { Version } from './versions'

export const loadHistory = () => import('./History.svelte')

export const versionsOf = async (path: string): Promise<Version[]> =>
  (await import('./versions')).versionsOf(path)

export const versionText = async (version: Version, notePath: string): Promise<string> =>
  (await import('./versions')).versionText(version, notePath)
