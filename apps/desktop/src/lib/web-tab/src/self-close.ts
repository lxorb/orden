import { takeKeyboard } from '../../take-keyboard'

export async function closeItself(tab: string, opener: string): Promise<void> {
  const { workspace } = await import('../../workspace.svelte')
  const shown = workspace.activeTabId === tab
  if (workspace.tabs.some((one) => one.id === opener)) workspace.activate(opener)
  workspace.close(tab)
  if (shown) void takeKeyboard()
}
