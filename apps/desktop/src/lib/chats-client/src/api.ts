import type { AgentVerbs, TabKindParts } from '@orden/contracts'
import './shell-parts'
export { hush } from './hush.svelte'
export { sendRows } from './send-rows'
export type { ChatEntry, Chats } from './shapes'

const away = <T>(): Promise<T> => new Promise<never>(() => undefined)

export const chatStore = () => (__EVEN_PLUGIN__ ? away<typeof import('./store.svelte')>() : import('./store.svelte'))

export const chatOpening = () => (__EVEN_PLUGIN__ ? away<typeof import('./view/open')>() : import('./view/open'))

export const chatDeleting = () => (__EVEN_PLUGIN__ ? away<typeof import('./deleting')>() : import('./deleting'))

export const chatContext = () => (__EVEN_PLUGIN__ ? away<typeof import('./context')>() : import('./context'))

export const wakeChats = () => (__EVEN_PLUGIN__ ? away<typeof import('./start.svelte')>() : import('./start.svelte'))

export const retireChats = () => (__EVEN_PLUGIN__ ? away<typeof import('./retired')>() : import('./retired'))

export const chatsCarried = async (path: string, folder: string) =>
  (await import('./leaving')).chatsCarried(path, folder)

export const loadChatTab = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./view/ChatTab.svelte')>() : import('./view/ChatTab.svelte')

export const loadChatsPanel = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./view/ChatsPanel.svelte')>() : import('./view/ChatsPanel.svelte')

export const loadChatLinks = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./view/ChatLinks.svelte')>() : import('./view/ChatLinks.svelte')

export const chatTabKind: TabKindParts = {
  open: async (path, how) => {
    ;(await chatOpening()).openChat(path, how)
  },
  make: async (folder, name) => {
    await (await chatOpening()).makeChat(folder, name)
  },
}

export const chatVerbs = () =>
  __EVEN_PLUGIN__ ? away<AgentVerbs>() : import('./agent-verbs').then((one) => one.chatVerbs)
