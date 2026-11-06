/** Orden's own chats as a provider (#321): the chats store seen through
 *  `@orden/chats/provider`. A conversation of it still opens in the chat tab. */

import type { Message } from '@orden/chats'
import type {
  Connection,
  Conversation,
  Page,
  ProviderEvent,
  ProviderMessage,
} from '@orden/chats/provider'
import type { ChatEntry, Chats } from '../api'

export const ORDEN = 'orden'

export function conversationOf(entry: ChatEntry): Conversation {
  return {
    id: entry.id,
    title: entry.name,
    kind: 'channel',
    people: [],
    lastAt: entry.lastAt,
    unread: entry.unread,
    mentions: entry.mentions,
    mutedUntil: entry.mutedUntil,
  }
}

function messageOf(chat: string, message: Message, me: string | null): ProviderMessage {
  return {
    id: message.id,
    conversation: chat,
    author: { id: message.author, name: message.author },
    at: message.at,
    text: message.deleted ? '' : message.body,
    attachments: message.files.map((file) => ({
      ref: file.hash,
      name: file.name,
      type: file.type,
      size: file.size,
    })),
    mine: message.author === me,
    ...(message.parent ? { replyTo: message.parent } : {}),
  }
}

export function ordenConnection(chats: () => Chats): Connection {
  return {
    account: { id: ORDEN, label: 'Orden' },
    conversations: () => Promise.resolve(chats().list.map(conversationOf)),
    async history(conversation, ask): Promise<Page> {
      const before = ask.before === undefined ? undefined : Number(ask.before)
      const messages = await chats().history(conversation, {
        limit: ask.limit,
        ...(before !== undefined ? { before } : {}),
      })
      const first = messages[0]
      return {
        messages: messages.map((one) => messageOf(conversation, one, chats().me)),
        before: first && first.seq > 1 ? String(first.seq) : null,
      }
    },
    async send(conversation, draft) {
      const store = chats()
      const id = await store.post(conversation, {
        body: draft.text,
        ...(draft.replyTo ? { parent: draft.replyTo } : {}),
      })
      const me = store.me ?? ''
      return {
        id,
        conversation,
        author: { id: me, name: me },
        at: Date.now(),
        text: draft.text,
        attachments: [],
        mine: true,
        ...(draft.replyTo ? { replyTo: draft.replyTo } : {}),
      }
    },
    start(hear: (event: ProviderEvent) => void) {
      const store = chats()
      const listed = store.watch(() =>
        hear({ t: 'conversations', conversations: store.list.map(conversationOf) }),
      )
      const arrived = store.heard((chat, messages) => {
        for (const one of messages) hear({ t: 'message', message: messageOf(chat, one, store.me) })
      })
      return () => {
        listed()
        arrived()
      }
    },
    async attachment(conversation, _message, ref) {
      const url = await chats().fileUrl(conversation, ref)
      if (!url) throw new Error('that file is not here')
      return new Uint8Array(await (await fetch(url)).arrayBuffer())
    },
    markRead: (conversation, upTo) => chats().markRead(conversation, Number(upTo)),
    close: () => Promise.resolve(),
  }
}
