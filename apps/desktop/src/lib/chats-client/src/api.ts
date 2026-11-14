import './shell-parts'
export { EVERY_DAY, hush, WEEKDAYS, WORKING_HOURS } from './hush.svelte'
export { priorities } from './priorities.svelte'
export type { ChatEntry, Chats } from './shapes'

const away = <T>(): Promise<T> => new Promise<never>(() => undefined)

export const chatStore = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./store.svelte')>() : import('./store.svelte')

export const chatOpening = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./view/open')>() : import('./view/open')

export const chatSending = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./send')>() : import('./send')

export const chatContext = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./context')>() : import('./context')

export const wakeChats = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./start.svelte')>() : import('./start.svelte')

export const retireChats = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./retired')>() : import('./retired')

export const chatLeaving = () =>
  __EVEN_PLUGIN__
    ? away<never>()
    : Promise.all([import('./http'), import('./pointers'), import('./places')]).then(
        ([http, pointers, places]) => ({
          listChats: http.listChats,
          moveChat: http.moveChat,
          chatName: pointers.chatName,
          readPointer: pointers.readPointer,
          keepOwnPointer: places.keepOwnPointer,
          lastMoved: places.lastMoved,
          movedHere: places.movedHere,
          ownPointer: places.ownPointer,
        }),
      )

export const loadChatTab = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./view/ChatTab.svelte')>() : import('./view/ChatTab.svelte')

export const loadChatsPanel = () =>
  __EVEN_PLUGIN__
    ? away<typeof import('./view/ChatsPanel.svelte')>()
    : import('./view/ChatsPanel.svelte')

export const loadChatLinks = () =>
  __EVEN_PLUGIN__
    ? away<typeof import('./view/ChatLinks.svelte')>()
    : import('./view/ChatLinks.svelte')
