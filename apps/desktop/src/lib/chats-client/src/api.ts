import type { TabKindParts } from '@orden/contracts'
import './shell-parts'
export { hush } from './hush.svelte'
export { sendRows } from './send-rows'
export type { ChatEntry, Chats } from './shapes'
const hosted = () => (__ORDEN_APP__ === 'orden' ? import('./view/host-here') : Promise.resolve(null))
export const chatStore = () => import('./store.svelte')
export const chatPlaces = () => import('./places-here.svelte').then((one) => one.placesHere)
export const chatOpening = () => hosted().then(() => import('./view/open'))
export const chatsDemo = () => hosted().then(() => import('./demo'))
export const chatDeleting = () => import('./deleting')
export const chatContext = () => import('./context')
export const wakeChats = () => import('./start.svelte')
export const chatsCarried = async (path: string, folder: string) =>
  (await import('./leaving')).chatsCarried(path, folder)
export const loadChatTab = () => hosted().then(() => import('./view/ChatTab.svelte'))
export const loadChatsPanel = () => hosted().then(() => import('./view/ChatsPanel.svelte'))
export const loadChatLinks = () => hosted().then(() => import('./view/ChatLinks.svelte'))
export const chatTabKind: TabKindParts = {
  open: async (path, how) => {
    ;(await chatOpening()).openChat(path, how)
  },
  make: async (folder, name) => {
    await (await chatOpening()).makeChat(folder, name)
  },
}
export const chatVerbs = () => hosted().then(() => import('./agent-verbs').then((one) => one.chatVerbs))
