import { account } from './account.svelte'
import { api, turnedDown } from './client'
import type { AccountSettings } from './routes'
import { forget, isRecord, keepJson, stored } from '../../platform/src/api'

interface Kept {
  who: string | null
  patch: AccountSettings
}

const said = (value: unknown) => JSON.stringify(value)

export class AccountOwed {
  sends = 0

  session = 0

  constructor(private readonly key: string) {
    account.forgetWithSession(() => {
      this.session++
      forget(this.key)
    })
    account.holdsNoAccount(() => {
      if (this.kept?.who === null) forget(this.key)
    })
  }

  private get kept(): Kept | null {
    const kept = stored(this.key)
    if (!isRecord(kept)) return null
    return {
      who: typeof kept.who === 'string' ? kept.who : null,
      patch: isRecord(kept.patch) ? kept.patch : {},
    }
  }

  private get mine(): Kept | null {
    const kept = this.kept
    const who = account.user?.id ?? null
    return kept && (kept.who === null || who === null || kept.who === who) ? kept : null
  }

  get standing(): boolean {
    return this.mine !== null
  }

  send(patch: AccountSettings): void {
    this.sends++
    if (account.noAccountForSure) return
    const mine = this.mine
    keepJson(this.key, {
      who: account.user?.id ?? mine?.who ?? null,
      patch: { ...mine?.patch, ...patch },
    })

    const token = account.accountToken
    if (token) void this.settle(token)
  }

  async settle(token: string): Promise<void> {
    const owed = this.mine?.patch ?? {}
    if (!Object.keys(owed).length) return

    const session = this.session
    if (!(await this.delivered(token, owed, session))) return
    if (this.session !== session) return

    const mine = this.mine
    const rest = Object.fromEntries(
      Object.entries(mine?.patch ?? {}).filter(
        ([name, value]) => said(value) !== said(owed[name as keyof AccountSettings]),
      ),
    )
    if (Object.keys(rest).length) keepJson(this.key, { who: mine?.who ?? null, patch: rest })
    else forget(this.key)
  }

  private async delivered(
    token: string,
    patch: AccountSettings,
    session: number,
  ): Promise<boolean> {
    try {
      await api.saveSettings(token, patch)
      return true
    } catch (error) {
      if (!turnedDown(error)) return false
      const keys = Object.keys(patch) as (keyof AccountSettings)[]
      if (keys.length < 2) return true
      for (const key of keys) {
        if (this.session !== session) return true
        if (!(await this.delivered(token, { [key]: patch[key] }, session))) return false
      }
      return true
    }
  }
}
