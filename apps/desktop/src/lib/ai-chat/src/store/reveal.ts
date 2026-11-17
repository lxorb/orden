import { revealPanel, workspace } from '../../../workspace/src/api'
import { chat } from './chat.svelte'

export function revealChat(): void {
  const id = chat.head?.id
  const tab = workspace.tabs.find(
    (one) => one.kind === 'chat' && one.address === id && workspace.panes.at(one.paneId),
  )
  if (tab) workspace.panes.activate(tab.paneId, tab.id)
  else if (workspace.openOn(workspace.sideOf('ask')) !== 'ask') revealPanel('ask')
}

export function chatToTab(): void {
  const head = chat.head
  workspace.openChat(
    head?.kept ? head.id : undefined,
    head?.kept ? head.title || 'Untitled' : undefined,
  )
  const side = workspace.sideOf('ask')
  if (workspace.openOn(side) === 'ask') workspace.closePanel(side)
}

export function newChatTab(): void {
  workspace.openChat()
}
