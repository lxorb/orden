import type { ChatProvider, Host } from '@orden/chats/provider'
import { secretName } from '@orden/chats/provider'
import { mailProvider } from '@orden/chats/mail'
import { keepJson, stored, isRecord, isString } from '../stored'
import { connected, type Connected } from './connected.svelte'

const KEY = 'nib:chat-accounts'

export const PROVIDERS: readonly ChatProvider[] = [mailProvider]

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
  ) {}

  providerOf(id: string): ChatProvider | undefined {
    return this.providers.find((one) => one.id === id)
  }

  private keepSaved(next: readonly Saved[]): void {
    this.saved = next
    keepJson(KEY, next)
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.saved = savedOf(stored(KEY))
    for (const one of this.saved) void this.relink(one)
  }

  async relink(one: Saved): Promise<void> {
    const provider = this.providerOf(one.provider)
    if (!provider?.available(this.host)) return
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
      await this.hub.link(provider, values, this.host)
    } catch (error) {
      this.failed = [
        ...this.failed,
        { provider: one.provider, account: one.account, reason: reasonOf(error) },
      ]
    }
  }

  async connect(
    providerId: string,
    values: Readonly<Record<string, string>>,
  ): Promise<string | null> {
    const provider = this.providerOf(providerId)
    if (!provider) return 'unknown service'
    try {
      const linked = await this.hub.link(provider, values, this.host)
      const account = linked.account.id
      const config: Record<string, string> = {}
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
      return null
    } catch (error) {
      return reasonOf(error)
    }
  }

  async disconnect(providerId: string, account: string): Promise<void> {
    await this.hub.unlink(providerId, account)
    const provider = this.providerOf(providerId)
    for (const field of provider?.fields ?? []) {
      if (field.secret) await this.host.keepSecret(secretName(providerId, account, field.key), null)
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
