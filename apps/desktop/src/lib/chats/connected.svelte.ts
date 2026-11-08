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
import { type Dial, oneLink } from './one-link'
import { conversationOf, ORDEN } from './providers/orden'
import { Remote } from './remote.svelte'
import { dropRemote, keepRemote } from './remotes'
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
      if (!found || event.message.thread) return linked
      const next = [...linked.conversations]
      next[at] = {
        ...found,
        lastAt: Math.max(found.lastAt ?? 0, event.message.at),
        unread: event.message.mine ? found.unread : found.unread + 1,
        snippet: event.message.text.split('\n', 1)[0] ?? '',
      }
      return { ...linked, conversations: next }
    }
    case 'deleted':
    case 'changed':
    case 'typing':
    case 'presence':
    case 'read':
      return linked
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

  wanted: (provider: string, account: string) => boolean = () => true
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing draws these
  private readonly turns = new Map<string, Promise<Linked>>()

  constructor(private readonly dial: Dial = oneLink) {}

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

  hear(listener: (provider: string, account: string, event: ProviderEvent) => void): () => void {
    this.hearers.add(listener)
    return () => this.hearers.delete(listener)
  }

  link(
    provider: ChatProvider,
    config: Readonly<Record<string, string>>,
    host: Host,
    known?: string,
  ): Promise<Linked> {
    const turn = `${provider.id}\n${known ?? '\u0000'}`
    const next = (this.turns.get(turn) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.linkNow(provider, config, host, known))
    this.turns.set(turn, next)
    void next
      .catch(() => undefined)
      .then(() => {
        if (this.turns.get(turn) === next) this.turns.delete(turn)
      })
    return next
  }

  private async linkNow(
    provider: ChatProvider,
    config: Readonly<Record<string, string>>,
    host: Host,
    known: string | undefined,
  ): Promise<Linked> {
    if (known !== undefined) await this.unlink(provider.id, known)
    const connection = await this.dial(provider, config, host, known, (account) =>
      this.wanted(provider.id, account),
    )
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
    void this.drop(provider.id, account.id)
    this.linked = [...this.linked, linked]
    const key = `${provider.id}\n${account.id}`
    const remote = new Remote(
      { provider: provider.id, account: account.id },
      () => this.find(provider.id, account.id),
      (conversation) => this.seen(provider.id, account.id, conversation),
    )
    keepRemote(remote)
    this.stops.set(
      key,
      connection.start((event) => {
        remote.heard(event)
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
    await this.drop(provider, account)
  }

  private drop(provider: string, account: string): Promise<void> {
    const key = `${provider}\n${account}`
    this.stops.get(key)?.()
    this.stops.delete(key)
    dropRemote(provider, account)
    const found = this.find(provider, account)
    this.linked = this.linked.filter((one) => one !== found)
    return found?.connection.close().catch(() => undefined) ?? Promise.resolve()
  }

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
