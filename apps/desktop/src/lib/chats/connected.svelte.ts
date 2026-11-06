/** Every chat service the reader is connected to, as one list (#321): Orden's own chats
 *  from the chats store, and each connected account's conversations as its provider
 *  says them. */

import type {
  Account,
  ChatProvider,
  Connection,
  Conversation,
  Host,
  ProviderEvent,
  Status,
} from '@orden/chats/provider'
import { newestFirst } from '@orden/chats/provider'
import { conversationOf, ORDEN } from './providers/orden'
import { store } from './view/source.svelte'

export interface Row {
  provider: string
  account: string
  conversation: Conversation
}

export interface Linked {
  provider: ChatProvider
  account: Account
  connection: Connection
  status: Status
  reason: string | null
  conversations: readonly Conversation[]
}

function heardInto(linked: Linked, event: ProviderEvent): Linked {
  switch (event.t) {
    case 'status':
      return { ...linked, status: event.status, reason: event.reason ?? null }
    case 'conversations':
      return { ...linked, conversations: [...event.conversations] }
    case 'conversation': {
      const rest = linked.conversations.filter((one) => one.id !== event.conversation.id)
      return { ...linked, conversations: [event.conversation, ...rest] }
    }
    case 'gone':
      return {
        ...linked,
        conversations: linked.conversations.filter((one) => one.id !== event.conversation),
      }
    case 'message': {
      const at = linked.conversations.findIndex((one) => one.id === event.message.conversation)
      const found = linked.conversations[at]
      if (!found) return linked
      const next = [...linked.conversations]
      next[at] = {
        ...found,
        lastAt: Math.max(found.lastAt ?? 0, event.message.at),
        unread: event.message.mine ? found.unread : found.unread + 1,
        snippet: event.message.text.split('\n', 1)[0] ?? '',
      }
      return { ...linked, conversations: next }
    }
  }
}

export class Connected {
  linked = $state.raw<readonly Linked[]>([])
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing draws these
  private readonly stops = new Map<string, () => void>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing draws these
  private readonly hearers = new Set<
    (provider: string, account: string, event: ProviderEvent) => void
  >()

  /** Orden's chats first, then every account's, each newest first. */
  rows(): Row[] {
    const own = store().list.map((entry) => ({
      provider: ORDEN,
      account: ORDEN,
      conversation: conversationOf(entry),
    }))
    const others = this.linked.flatMap((one) =>
      one.conversations.map((conversation) => ({
        provider: one.provider.id,
        account: one.account.id,
        conversation,
      })),
    )
    return [...own, ...others].sort((a, b) => newestFirst(a.conversation, b.conversation))
  }

  find(provider: string, account: string): Linked | undefined {
    return this.linked.find((one) => one.provider.id === provider && one.account.id === account)
  }

  /** Hears every event of every account. Answers how to stop. */
  hear(listener: (provider: string, account: string, event: ProviderEvent) => void): () => void {
    this.hearers.add(listener)
    return () => this.hearers.delete(listener)
  }

  async link(
    provider: ChatProvider,
    config: Readonly<Record<string, string>>,
    host: Host,
  ): Promise<Linked> {
    const connection = await provider.connect(config, host)
    const account = connection.account
    await this.unlink(provider.id, account.id)
    const conversations = await connection.conversations().catch(() => [])
    const linked: Linked = {
      provider,
      account,
      connection,
      status: 'online',
      reason: null,
      conversations,
    }
    this.linked = [...this.linked, linked]
    const key = `${provider.id}\n${account.id}`
    this.stops.set(
      key,
      connection.start((event) => {
        this.linked = this.linked.map((one) =>
          one.provider.id === provider.id && one.account.id === account.id
            ? heardInto(one, event)
            : one,
        )
        for (const hear of this.hearers) hear(provider.id, account.id, event)
      }),
    )
    return linked
  }

  async unlink(provider: string, account: string): Promise<void> {
    const key = `${provider}\n${account}`
    this.stops.get(key)?.()
    this.stops.delete(key)
    const found = this.find(provider, account)
    this.linked = this.linked.filter((one) => one !== found)
    await found?.connection.close().catch(() => undefined)
  }

  /** The reader opened a conversation: nothing in it is unread now. */
  seen(provider: string, account: string, conversation: string): void {
    this.linked = this.linked.map((one) =>
      one.provider.id === provider && one.account.id === account
        ? {
            ...one,
            conversations: one.conversations.map((it) =>
              it.id === conversation ? { ...it, unread: 0 } : it,
            ),
          }
        : one,
    )
  }
}

export const connected = new Connected()
