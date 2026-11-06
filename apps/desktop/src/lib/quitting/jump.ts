import { workspace } from '../workspace.svelte'
import type { Row } from './rows'

export async function jump(row: Row): Promise<void> {
  if (row.kind === 'terminal') {
    workspace.activeTabId = row.id
    return
  }

  workspace.showPanel('ask')
  const { chat } = await import('../ai/sidebar/chat.svelte')
  await chat.openThread(row.id)
}
