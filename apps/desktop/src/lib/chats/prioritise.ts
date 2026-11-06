import { complete } from '../ai/complete'
import { ai } from '../ai/store.svelte'
import { notify } from '../notify'
import { connected } from './connected.svelte'
import { openConversation } from './linked'
import { type Asker, priorities, rowKey } from './priorities.svelte'
import { ORDEN, ordenConnection } from './providers/orden'
import { store } from './view/source.svelte'
import { todayOf } from '@orden/bases'
import type { Level } from '@orden/chats/priority'
import type { Connection } from '@orden/chats/provider'

const asker = (): Asker | null => {
  const provider = ai.providerFor('ask')
  if (!provider) return null
  return (messages) => complete({ provider, model: provider.model, messages })
}

let started = false

export function startPriorities(): void {
  if (started) return
  started = true
  priorities.useAsker(asker)
  connected.hear((provider, account, event) => {
    if (event.t !== 'message' || event.message.mine) return
    if (!priorities.on && !priorities.drafting) return
    const linked = connected.find(provider, account)
    const conversation = linked?.conversations.find((one) => one.id === event.message.conversation)
    if (!linked || !conversation) return
    const key = rowKey(provider, account, conversation.id)
    const title = conversation.title ?? event.message.author.name
    void considered(key, title, linked.connection, conversation.id)
      .then((level) => {
        if (!level || !priorities.notify.includes(level)) return
        notify(title, `${event.message.author.name}: ${event.message.text}`, key, () =>
          openConversation({ provider, account, conversation: conversation.id }, title),
        )
      })
      .catch(() => undefined)
  })
  const own = ordenConnection(store)
  own.start((event) => {
    if (event.t !== 'message' || event.message.mine) return
    if (!priorities.on && !priorities.drafting) return
    const chat = event.message.conversation
    const key = rowKey(ORDEN, ORDEN, chat)
    void considered(key, store().entry(chat)?.name ?? '', own, chat).catch(() => undefined)
  })
}

async function considered(
  key: string,
  title: string,
  connection: Connection,
  conversation: string,
): Promise<Level | null> {
  const page = await connection.history(conversation, { limit: 30 })
  const level = await priorities.heard(key, title, page.messages.slice(-8))
  const mine = page.messages.filter((one) => one.mine && one.text).map((one) => one.text)
  await priorities.suggest(key, title, page.messages.slice(-10), mine, todayOf())
  return level
}
