import type { TabKindParts } from '@orden/contracts'
import './shell-parts'
export { dndUntil, hush } from './hush.svelte'
export { sendRows } from './send-rows'
export type { ChatEntry, Chats } from './shapes'
const hosted = () => (__ORDEN_APP__ === 'orden' ? import('./view/host-here') : Promise.resolve(null))
const elsewhere = (): Promise<never> => Promise.reject(new Error('only the full Orden keeps chats in files'))
export const chatStore = () => import('./store.svelte')
export const chatHosting = () => import('./view/host')
export const chatPlaces = () =>
  __ORDEN_APP__ === 'orden' ? import('./places-here.svelte').then((one) => one.placesHere) : elsewhere()
export const chatOpening = () => hosted().then(() => import('./view/open'))
export const chatsDemo = () => (__ORDEN_APP__ === 'orden' ? hosted().then(() => import('./demo')) : elsewhere())
export const chatDeleting = () => import('./deleting')
export const chatContext = () => (__ORDEN_APP__ === 'orden' ? import('./context') : elsewhere())
export const wakeChats = () => import('./start.svelte')
export const chatsCarried = async (path: string, folder: string) =>
  (await (__ORDEN_APP__ === 'orden' ? import('./leaving') : elsewhere())).chatsCarried(path, folder)
export const loadChatTab = () => hosted().then(() => import('./view/ChatTab.svelte'))
export const loadChatsPanel = () => hosted().then(() => import('./view/ChatsPanel.svelte'))
export const loadChatLinks = () =>
  __ORDEN_APP__ === 'orden' ? hosted().then(() => import('./view/ChatLinks.svelte')) : elsewhere()
export const chatTabKind: TabKindParts = {
  open: async (path, how) => {
    ;(await chatOpening()).openChat(path, how)
  },
  make: async (folder, name) => {
    await (await chatOpening()).makeChat(folder, name)
  },
}
export const chatVerbs = () =>
  __ORDEN_APP__ === 'orden' ? hosted().then(() => import('./agent-verbs').then((one) => one.chatVerbs)) : elsewhere()
