import type { TabKindParts } from '@orden/contracts'
import './shell-parts'
export { hush } from './hush.svelte'
export { sendRows } from './send-rows'
export type { ChatEntry, Chats } from './shapes'
export const chatStore = () => import('./store.svelte')
export const chatOpening = () => import('./view/open')
export const chatDeleting = () => import('./deleting')
export const chatContext = () => import('./context')
export const wakeChats = () => import('./start.svelte')
export const retireChats = () => import('./retired')
export const chatsCarried = async (path: string, folder: string) =>
  (await import('./leaving')).chatsCarried(path, folder)
export const loadChatTab = () => import('./view/ChatTab.svelte')
export const loadChatsPanel = () => import('./view/ChatsPanel.svelte')
export const loadChatLinks = () => import('./view/ChatLinks.svelte')
export const chatTabKind: TabKindParts = {
  open: async (path, how) => {
    ;(await chatOpening()).openChat(path, how)
  },
  make: async (folder, name) => {
    await (await chatOpening()).makeChat(folder, name)
  },
}
export const chatVerbs = () => import('./agent-verbs').then((one) => one.chatVerbs)
