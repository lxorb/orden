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
      return chat ? store.speak(chat, whoOf(from), body) : null
    },
    picture: (path, from, url, { width, height, name, caption }) => {
      const chat = chatOf(path)
      if (!chat) return null
      const type = /\.(jpe?g)$/i.test(url) ? 'image/jpeg' : /\.webp$/i.test(url) ? 'image/webp' : 'image/png'
      const file = {
        hash: store.filed(url),
        name: name ?? url.slice(url.lastIndexOf('/') + 1),
        size: 0,
        type,
        width,
        height,
      }
      return store.speak(chat, whoOf(from), caption ?? '', { files: [file] })
    },
    react: (path, message, who, emoji) => {
      const chat = chatOf(path)
      if (chat) store.place(chat, whoOf(who), { kind: 'react', id: store.id(), target: message, emoji, on: true })
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
