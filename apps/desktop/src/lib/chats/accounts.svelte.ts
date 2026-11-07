import type { ChatProvider, Host } from '@orden/chats/provider'
import { secretName } from '@orden/chats/provider'
import { mailProvider } from '@orden/chats/mail'
import { gmailProvider, microsoftProvider } from '@orden/chats/mail-oauth'
import { chatsOn } from '../settings.svelte'
import { keepJson, stored, isRecord, isString } from '../stored'
import { connected, type Connected } from './connected.svelte'
import { signal } from './providers/signal'
import { slack } from './providers/slack'
import { telegram } from './providers/telegram'
import { whatsapp } from './providers/whatsapp'

const KEY = 'orden:chat-accounts'

const PROVIDERS: readonly ChatProvider[] = [
  mailProvider,
  gmailProvider,
  microsoftProvider,
  telegram,
  slack,
  whatsapp,
  signal,
]

export interface Saved {
  provider: string
  account: string
  config: Record<string, string>
}

export interface Failure {
  provider: string
  account: string
  reason: string
}

function savedOf(value: unknown): Saved[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((one: unknown) => {
    if (!isRecord(one) || !isString(one.provider) || !isString(one.account)) return []
    const config: Record<string, string> = {}
    if (isRecord(one.config)) {
      for (const [key, value] of Object.entries(one.config))
        if (isString(value)) config[key] = value
    }
    return [{ provider: one.provider, account: one.account, config }]
  })
}

export class Accounts {
  saved = $state.raw<readonly Saved[]>([])
  failed = $state.raw<readonly Failure[]>([])
  private started = false

  constructor(
    private readonly host: Host,
    private readonly hub: Connected = connected,
    private readonly providers: readonly ChatProvider[] = PROVIDERS,
    private readonly on: () => boolean = chatsOn,
  ) {}

  extra = $state.raw<readonly ChatProvider[]>([])

  get offered(): readonly ChatProvider[] {
    return [...this.providers, ...this.extra]
  }

  offer(provider: ChatProvider): void {
    this.extra = [...this.extra.filter((one) => one.id !== provider.id), provider]
  }

  providerOf(id: string): ChatProvider | undefined {
    return this.offered.find((one) => one.id === id)
  }

  private keepSaved(next: readonly Saved[]): void {
    this.saved = next
    keepJson(KEY, next)
  }

  start(): void {
    if (this.started || !this.on()) return
    this.started = true
    this.saved = savedOf(stored(KEY))
    for (const one of this.saved) void this.relink(one)
  }

  async stop(): Promise<void> {
    this.started = false
    this.failed = []
    await Promise.all(
      this.hub.linked.map((one) => this.hub.unlink(one.provider.id, one.account.id)),
    )
  }

  async relink(one: Saved): Promise<void> {
    const provider = this.providerOf(one.provider)
    if (!this.on() || !provider?.available(this.host)) return
    const values = { ...one.config }
    for (const field of provider.fields) {
      if (!field.secret) continue
      const secret = await this.host.secret(secretName(provider.id, one.account, field.key))
      if (secret) values[field.key] = secret
    }
    this.failed = this.failed.filter(
      (it) => it.provider !== one.provider || it.account !== one.account,
    )
    try {
      if (!this.on()) return
      const linked = await this.hub.link(provider, values, this.host, one.account)
      if (!this.on()) await this.hub.unlink(provider.id, linked.account.id)
    } catch (error) {
      this.failed = [
        ...this.failed,
        { provider: one.provider, account: one.account, reason: reasonOf(error) },
      ]
    }
  }

  given(providerId: string, account: string): Record<string, string> {
    const provider = this.providerOf(providerId)
    const saved = this.saved.find((one) => one.provider === providerId && one.account === account)
    const out: Record<string, string> = {}
    for (const field of provider?.fields ?? []) {
      const value = saved?.config[field.key]
      if (!field.secret && value !== undefined) out[field.key] = value
    }
    return out
  }

  async connect(
    providerId: string,
    values: Readonly<Record<string, string>>,
    replacing?: string,
  ): Promise<string | null> {
    const provider = this.providerOf(providerId)
    if (!provider) return 'unknown service'
    if (!this.on()) return 'chats are off'
    try {
      const linked = await this.hub.link(provider, values, this.host)
      const account = linked.account.id
      const config: Record<string, string> = { ...linked.account.keep }
      for (const field of provider.fields) {
        const value = values[field.key]
        if (value === undefined || value === '') continue
        if (field.secret)
          await this.host.keepSecret(secretName(provider.id, account, field.key), value)
        else config[field.key] = value
      }
      this.keepSaved([
        ...this.saved.filter((one) => one.provider !== provider.id || one.account !== account),
        { provider: provider.id, account, config },
      ])
      this.failed = this.failed.filter(
        (it) => it.provider !== provider.id || (it.account !== account && it.account !== replacing),
      )
      if (replacing !== undefined && replacing !== account)
        await this.disconnect(provider.id, replacing)
      return null
    } catch (error) {
      return reasonOf(error)
    }
  }

  async disconnect(providerId: string, account: string): Promise<void> {
    await this.hub.unlink(providerId, account)
    const provider = this.providerOf(providerId)
    await provider?.forget?.(account, this.host).catch(() => undefined)
    for (const field of provider?.fields ?? []) {
      if (field.secret) await this.host.keepSecret(secretName(providerId, account, field.key), null)
    }
    for (const kept of provider?.kept ?? []) {
      await this.host.keepSecret(secretName(providerId, account, kept), null)
    }
    this.failed = this.failed.filter((it) => it.provider !== providerId || it.account !== account)
    this.keepSaved(
      this.saved.filter((one) => one.provider !== providerId || one.account !== account),
    )
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
