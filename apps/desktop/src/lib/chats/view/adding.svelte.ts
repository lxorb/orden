import type { ChatProvider, ConnectField } from '@orden/chats/provider'
import { untrack } from 'svelte'
import { key, t } from '../../i18n.svelte'
import { workspace } from '../../workspace.svelte'
import { connected } from '../connected.svelte'
import { accounts } from '../linked'
import { screens } from '../providers/screens.svelte'
import { ADVANCED } from './add-steps'
import { chatsAreOn } from './open'

interface Again {
  provider: string
  account: string
}

type Step = 'choose' | 'connect' | 'check' | 'done'

interface Added {
  provider: string
  account: string
  label: string
}

class Adding {
  again = $state.raw<Again | null>(null)
  asked = $state(0)
  busy = $state(false)
  step = $state<Step>('choose')
  provider = $state.raw<ChatProvider | null>(null)
  given = $state.raw<Readonly<Record<string, string>>>({})
  replacing = $state<string | undefined>(undefined)
  values = $state<Record<string, string>>({})
  understood = $state(false)
  problem = $state<string | null>(null)
  advanced = $state(false)
  account = $state.raw<Added | null>(null)
  chosen = $state.raw<readonly string[]>([])
  settled = $state(false)
  seen = -1
  private attempt = 0

  get entered(): boolean {
    return (
      this.step !== 'done' &&
      (this.understood || Object.values(this.values).some((one) => one.trim() !== ''))
    )
  }

  get ready(): boolean {
    const provider = this.provider
    return (
      !!provider &&
      (!provider.warning || this.understood) &&
      provider.fields.every((field) => field.optional === true || this.valueOf(field).trim() !== '')
    )
  }

  valueOf(field: ConnectField): string {
    return (
      this.values[`${this.provider?.id ?? ''}:${field.key}`] ??
      this.given[field.key] ??
      field.initial ??
      field.options?.[0]?.value ??
      ''
    )
  }

  reset(): void {
    if (this.busy) this.stop()
    this.step = 'choose'
    this.provider = null
    this.given = {}
    this.replacing = undefined
    this.values = {}
    this.understood = false
    this.problem = null
    this.advanced = false
    this.account = null
    this.chosen = []
    this.settled = false
  }

  begin(one: ChatProvider): void {
    this.provider = one
    this.step = 'connect'
    this.understood = false
    this.problem = null
    this.advanced = false
  }

  async connect(): Promise<void> {
    const one = this.provider
    if (!this.ready || this.busy || !one) return
    this.busy = true
    this.step = 'check'
    this.problem = null
    const mine = ++this.attempt
    const asked: Record<string, string> = {}
    for (const field of one.fields) {
      const value = this.valueOf(field)
      if (value !== '') asked[field.key] = value
    }
    const before = new Set(
      connected.linked.filter((it) => it.provider.id === one.id).map((it) => it.account.id),
    )
    const reason = await accounts.connect(one.id, asked, this.replacing)
    screens.show(null)
    if (mine !== this.attempt) return
    this.busy = false
    if (reason !== null) {
      this.problem = reason
      if (one.fields.some((field) => ADVANCED.has(field.key))) this.advanced = true
      return
    }
    const theirs = connected.linked.filter((it) => it.provider.id === one.id)
    const fresh = theirs.find((it) => !before.has(it.account.id)) ?? theirs.at(-1)
    this.account = fresh
      ? { provider: one.id, account: fresh.account.id, label: fresh.account.label }
      : { provider: one.id, account: '', label: one.name }
    this.again = null
    this.values = {}
    this.step = 'done'
  }

  stop(): void {
    this.attempt += 1
    this.busy = false
    screens.cancelAll()
    this.step = 'connect'
  }

  back(): void {
    if (this.busy) {
      this.stop()
      return
    }
    if (this.step === 'check') this.step = 'connect'
    else if (this.step === 'connect' && this.replacing === undefined) {
      this.provider = null
      this.step = 'choose'
    } else if (this.step === 'done') this.reset()
  }

  takeAsk(): void {
    if (this.asked === this.seen) return
    this.seen = this.asked
    const again = this.again
    const known = again ? accounts.providerOf(again.provider) : undefined
    if (again && known) {
      this.reset()
      this.given = accounts.given(again.provider, again.account)
      this.replacing = again.account
      this.begin(known)
    } else if (this.step !== 'choose' && !this.entered && !this.busy) {
      this.reset()
    }
  }
}

export const adding = new Adding()

let watching = false

export function watchClosing(): void {
  if (watching) return
  watching = true
  $effect.root(() => {
    $effect(() => {
      if (workspace.connectTab) return
      untrack(() => {
        if (adding.step !== 'choose' || adding.busy) adding.reset()
        adding.again = null
      })
    })
  })
}

export function addChat(again: Again | null = null): void {
  if (!chatsAreOn()) return
  adding.again = again
  adding.asked += 1
  workspace.openConnect()
  watchClosing()
}

export function closeAdding(): void {
  adding.reset()
  workspace.closeConnect()
}

export async function mayLeave(): Promise<boolean> {
  if (!adding.entered && !adding.busy) return true
  const { prompt } = await import('../../prompt.svelte')
  const sure = await prompt.confirm({
    title: t('Stop adding this account?'),
    detail: t('What you entered is not kept.'),
    confirmLabel: key('Discard'),
    danger: true,
  })
  if (sure) adding.reset()
  return sure
}
