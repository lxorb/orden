import { invoke, waited } from '../../../platform/src/api'
import type { LocalKind } from '../providers'
import type { Limit } from './heard'
import { saidIn, type Standing, standingOf } from './standing'

const EVERY = 3000
const FOR = 5 * 60_000

interface Plan extends Standing {
  limit: Limit | null
  home: string | null
}

export interface LocalAccount {
  id: string
  kind: LocalKind
}

const unasked = (): Plan => ({
  state: 'unknown',
  program: null,
  plan: null,
  account: null,
  limit: null,
  home: null,
})

class Plans {
  local = $state<Record<string, Plan>>({})
  chatgpt = $state<{ email: string | null } | null | undefined>(undefined)
  chatgptLimit = $state<Limit | null>(null)

  private watching = new Set<string>()

  of(id: string): Plan {
    return this.local[id] ?? unasked()
  }

  async check(account: LocalAccount): Promise<Plan> {
    const said = await invoke<unknown>('ai_cli_status', {
      tool: account.kind,
      account: account.id,
    }).catch(() => null)
    const home =
      typeof said === 'object' &&
      said !== null &&
      typeof (said as { home?: unknown }).home === 'string'
        ? (said as { home: string }).home
        : null
    const now: Plan = {
      ...standingOf(account.kind, saidIn(said)),
      limit: this.of(account.id).limit,
      home,
    }
    this.local = { ...this.local, [account.id]: now }
    return now
  }

  async checkChatgpt(): Promise<void> {
    const said = await invoke<unknown>('chatgpt_account').catch(() => null)
    this.chatgpt =
      typeof said === 'object' && said !== null
        ? {
            email:
              typeof (said as { email?: unknown }).email === 'string'
                ? (said as { email: string }).email
                : null,
          }
        : null
  }

  watch(account: LocalAccount): void {
    if (this.watching.has(account.id)) return
    this.watching.add(account.id)
    const started = Date.now()

    const again = async () => {
      await waited(EVERY)
      const now = await this.check(account)
      if (now.state === 'in' || Date.now() - started > FOR) this.watching.delete(account.id)
      else void again()
    }
    void again()
  }

  heard(id: string, limit: Limit): void {
    this.local = { ...this.local, [id]: { ...this.of(id), limit } }
  }

  signedOut(id: string): void {
    this.local = { ...this.local, [id]: { ...this.of(id), state: 'out' } }
  }
}

export const plans = /* @__PURE__ */ new Plans()

export type LocalPlans = typeof plans
