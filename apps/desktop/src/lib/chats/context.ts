import { type Message, type Who } from '@orden/chats'
import { messagesText } from '@orden/chats/agent'
import { chatLink } from '@orden/chats/links'
import { chats } from './store.svelte'

const MOST_MESSAGES = 200
const MOST_CHARS = 40_000

export interface ChatPart {
  label: string
  text: string
}

export type Part = 'unread' | 'unread-or-newest'

export async function chatPart(chat: string, part: Part): Promise<ChatPart | null> {
  const entry = chats.entry(chat)
  if (!entry) return null
  const name = entry.name ?? 'chat'
  const newest = await chats.history(chat, { limit: MOST_MESSAGES })
  let messages: Message[] = newest.filter((one) => one.seq > entry.readSeq)
  const unread = messages.some((one) => one.author !== chats.me)
  if (!unread) {
    if (part === 'unread') return null
    messages = newest
  }
  if (!messages.length) return null

  const names = new Map<Who, string>()
  for (const member of await chats.members(chat).catch(() => [])) {
    names.set(member.who, member.name ?? 'Deleted account')
  }
  const reading = { me: chats.me, nameOf: (who: Who) => names.get(who) ?? who }

  let text = messagesText(name, messages, reading)
  while (text.length > MOST_CHARS && messages.length > 1) {
    messages = messages.slice(Math.ceil(messages.length / 4))
    text = messagesText(name, messages, reading)
  }
  const first = messages[0]
  const start = first ? chatLink(chat, first.id) : chatLink(chat)
  const head = unread ? `Unread in #${name} from [#${name}](${start})` : `#${name}, from ${start}`
  return { label: `#${name}`, text: `${head}\n${text}` }
}
