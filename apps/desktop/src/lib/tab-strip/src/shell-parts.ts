import { registerCommand } from '@orden/contracts'
import { closeWindow, isDesktop, platform } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { picks } from './drag.svelte'

const active = () => workspace.activeTabId ?? ''

function close(): void {
  const pick = picks.loaded
  const many = pick?.chosen.of(workspace.panes.focusedId) ?? []
  if (pick && many.length) void pick.closeChosen(many)
  else if (workspace.activeTabId || workspace.tabs.length || !isDesktop || platform() !== 'macos')
    void workspace.closeActive()
  else void closeWindow()
}

registerCommand('app.close', () => Promise.resolve(close))
registerCommand('app.duplicate-tab', async () => {
  const { duplicateTab } = await import('./ops')
  return () => duplicateTab(active())
})
registerCommand('pane.move-tab', async () => {
  const { moveToOtherPane } = await import('./ops')
  return () => moveToOtherPane(active())
})
