import type { OpenHow } from '../new-tab'
import { workspace } from '../workspace.svelte'
import { Accounts } from './accounts.svelte'
import { chatsAreOn } from './view/open'
import { conversationKey, type ConversationKey } from './conversation-key'
import { host } from './providers/host'

export const accounts = new Accounts(host)

export function openConversation(key: ConversationKey, title: string, how: OpenHow = {}): void {
  if (!chatsAreOn()) return
  const words = conversationKey(key)
  const open = workspace.tabs.find((one) => one.kind === 'channel' && one.note.text === words)
  if (open) {
    if (how.activate !== false) workspace.activeTabId = open.id
    return
  }
  workspace.openView(words, title, null, how, 'channel')
}
