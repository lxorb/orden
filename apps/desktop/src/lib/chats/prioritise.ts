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
import type { Connection, ProviderMessage } from '@orden/chats/provider'

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
    void consider(key, title, linked.connection, conversation.id)
      .then((said) => {
        if (!said?.level || !priorities.notify.includes(said.level)) return
        const newest = said.newest ?? event.message
        notify(title, `${newest.author.name}: ${newest.text}`, key, () =>
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
    void consider(key, store().entry(chat)?.name ?? '', own, chat).catch(() => undefined)
  })
}

interface Considered {
  level: Level | null
  newest: ProviderMessage | undefined
}

const considering = new Map<string, { again: boolean }>()

async function consider(
  key: string,
  title: string,
  connection: Connection,
  conversation: string,
): Promise<Considered | null> {
  const busy = considering.get(key)
  if (busy) {
    busy.again = true
    return null
  }
  const turn = { again: false }
  considering.set(key, turn)
  try {
    let said = await considered(key, title, connection, conversation)
    while (turn.again) {
      turn.again = false
      said = await considered(key, title, connection, conversation)
    }
    return said
  } finally {
    considering.delete(key)
  }
}

async function considered(
  key: string,
  title: string,
  connection: Connection,
  conversation: string,
): Promise<Considered> {
  const page = await connection.history(conversation, { limit: 30 })
  const level = await priorities.heard(key, title, page.messages.slice(-8))
  const mine = page.messages.filter((one) => one.mine && one.text).map((one) => one.text)
  await priorities.suggest(key, title, page.messages.slice(-10), mine, todayOf())
  return { level, newest: page.messages.filter((one) => !one.mine).at(-1) }
}
