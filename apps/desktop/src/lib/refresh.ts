import { workspace } from './workspace.svelte'

export async function refreshHere(): Promise<void> {
  const tab = workspace.active
  if (tab?.kind === 'web') {
    const { pages } = await import('./web-tab/src/api')
    await pages.step(tab.id, 'reload')
    return
  }
  const { sync } = await import('./sync.svelte')
  await sync.pass()
  if (sync.status === 'error' || sync.status === 'offline') {
    throw new Error(sync.lastError ?? 'sync failed')
  }
}
