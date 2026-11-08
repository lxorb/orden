import { revealPanel } from '../../focus'
import { workspace } from '../../workspace.svelte'

export function revealChat(): void {
  const tab = workspace.singleHere('chat')
  if (tab) workspace.panes.activate(tab.paneId, tab.id)
  else if (workspace.openOn(workspace.sideOf('ask')) !== 'ask') revealPanel('ask')
}

export function chatToTab(): void {
  workspace.openChat()
  const side = workspace.sideOf('ask')
  if (workspace.openOn(side) === 'ask') workspace.closePanel(side)
}
