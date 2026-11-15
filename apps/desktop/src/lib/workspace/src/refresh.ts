import { webPages } from '@orden/contracts'
import { workspace } from './workspace.svelte'

export async function refreshHere(): Promise<void> {
  const tab = workspace.active
  if (tab?.kind === 'web') {
    await webPages().step(tab.id, 'reload')
    return
  }
  const { sync } = await import('../../sync-store/src/api')
  await sync.pass()
  if (sync.status === 'error' || sync.status === 'offline') {
    throw new Error(sync.lastError ?? 'sync failed')
  }
}
