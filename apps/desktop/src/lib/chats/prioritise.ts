import { complete } from '../ai/complete'
import { heldForLife } from '../locks'
import { ai } from '../ai/store.svelte'
import { type Notice, show } from '../notify'
import { t } from '../i18n.svelte'
import { inHours, levelOf } from '@orden/chats/notify'
import { dndUntil, hush } from './hush.svelte'
import { inFront } from './on-screen'
import { chatsOn } from '../settings.svelte'
import { connected } from './connected.svelte'
import { openConversation } from './linked'
import { type Asker, priorities, rowKey } from './priorities.svelte'
import { ORDEN, ordenConnection } from './providers/orden'
import { store } from './view/source.svelte'
import { type ConversationKey, conversationKey } from './conversation-key'
import { remoteOf } from './remotes'
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
  let leads = false
  heldForLife('orden:chat-priorities', () => {
    leads = true
    return new Promise<never>(() => undefined)
  })
  connected.hear((provider, account, event) => {
    if (event.t !== 'message' || event.message.mine || !chatsOn()) return
    const linked = connected.find(provider, account)
    const conversation = linked?.conversations.find((one) => one.id === event.message.conversation)
    if (!linked || !conversation) return
    if (!priorities.on) {
      const where = { provider, account, conversation: conversation.id }
      if (
        leads &&
        !event.message.system &&
        !event.message.thread &&
        !plainlyQuiet(event.message, where)
      )
        show(priorityNotice(where, conversation.title ?? event.message.author.name, event.message))
    }
    if (!priorities.on && !priorities.drafting) return
    const key = rowKey(provider, account, conversation.id)
    const title = conversation.title ?? event.message.author.name
    void consider(key, title, linked.connection, conversation.id)
      .then((said) => {
        if (!said?.level || !priorities.notify.includes(said.level)) return
        if (!leads || quiet(provider, account, conversation.id, event.message)) return
        show(
          priorityNotice(
            { provider, account, conversation: conversation.id },
            title,
            said.newest ?? event.message,
          ),
        )
      })
      .catch(() => undefined)
  })
  const own = ordenConnection(store)
  own.start((event) => {
    if (event.t !== 'message' || event.message.mine || !chatsOn()) return
    if (!priorities.on && !priorities.drafting) return
    const chat = event.message.conversation
    const key = rowKey(ORDEN, ORDEN, chat)
    void consider(key, store().entry(chat)?.name ?? '', own, chat).catch(() => undefined)
  })
}

function plainlyQuiet(message: ProviderMessage, where: ConversationKey): boolean {
  if (quiet(where.provider, where.account, where.conversation, message)) return true
  const found = connected
    .find(where.provider, where.account)
    ?.conversations.find((one) => one.id === where.conversation)
  const level = remoteOf(conversationKey(where))?.notifies[where.conversation] ?? null
  const members = found?.members ?? (found?.people.length ?? 0) + 1
  if (levelOf(level, members) !== 'mentions') return false
  const self = connected.find(where.provider, where.account)?.account.self?.id
  return !(self && message.mentions?.includes(self))
}

export function quiet(
  provider: string,
  account: string,
  conversation: string,
  message: ProviderMessage,
  now = Date.now(),
): boolean {
  const linked = connected.find(provider, account)
  const found = linked?.conversations.find((one) => one.id === conversation)
  if (!found) return true
  if (found.mutedUntil != null && found.mutedUntil > now) return true
  if (inFront(conversationKey({ provider, account, conversation }))) return true
  const dnd = dndUntil()
  if (dnd !== null && dnd > now) return true
  const local = new Date(now)
  const moment = { now, day: local.getDay(), minute: local.getHours() * 60 + local.getMinutes() }
  if (!inHours(hush.hours, moment)) return true
  const level = remoteOf(conversationKey({ provider, account, conversation }))?.notifies[
    conversation
  ]
  if (level === 'nothing') return true
  if (level !== 'mentions') return false
  const self = linked?.account.self?.id
  return !(self && message.mentions?.includes(self))
}

export function priorityNotice(
  key: ConversationKey,
  title: string,
  newest: ProviderMessage,
): Notice {
  const previews = hush.previews
  return {
    title: previews ? title : t('New message'),
    body: previews ? `${newest.author.name}: ${newest.text}` : '',
    tag: conversationKey(key),
    silent: !hush.sound,
    opened: () => openConversation(key, title),
  }
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
