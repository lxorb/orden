import type { Who } from '@orden/chats'
import type { ChatsDemo, ChatsDemoPerson } from '@orden/contracts'
import { CHATS_WORD, EXPERIMENTAL_WORD, hiddenKinds } from '../../gates/src/api'
import { FixtureChats } from './view/fixture.svelte'
import { openChat } from './view/open'
import { useStore } from './view/source.svelte'

const whoOf = (id: string): Who => `user:${id}`
const OPENS = [EXPERIMENTAL_WORD, CHATS_WORD]
export function demoChats(me: ChatsDemoPerson): ChatsDemo {
  const store = new FixtureChats(whoOf(me.id))
  const chatOf = (path: string) => store.list.find((one) => one.path === path)?.id ?? null
  hiddenKinds.hidden = [...hiddenKinds.hidden.filter((word) => !OPENS.includes(word)), ...OPENS]
  useStore(store)
  return {
    add: (folder, name, members) => {
      const path = `${folder}/${name}.chat`
      const seated = members.map((one) => ({ who: whoOf(one.id), name: one.name, role: 'write' as const }))
      store.add(name, [{ who: whoOf(me.id), name: me.name, role: 'owner' }, ...seated], { path, root: folder })
      return path
    },
    say: (path, from, body) => {
      const chat = chatOf(path)
      if (chat) store.speak(chat, whoOf(from), body)
    },
    typing: (path, who, on) => {
      const chat = chatOf(path)
      if (chat) store.typing(chat, whoOf(who), on)
    },
    open: (path, how) => {
      openChat(path, how)
    },
  }
}
