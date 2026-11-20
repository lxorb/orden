import { account } from './account.svelte'
import { api, turnedDown } from './client'
import type { AccountSettings } from './routes'
import { forget, isRecord, keepJson, stored } from '../../platform/src/api'

interface Kept {
  who: string | null
  patch: AccountSettings
  base: AccountSettings
}
const SETTINGS_HEARD = 'orden:settings-heard'
const said = (value: unknown) => JSON.stringify(value)
export function heardSettings(): AccountSettings | undefined {
  const kept = stored(SETTINGS_HEARD)
  const who = account.user?.id
  return isRecord(kept) && who && kept.who === who && isRecord(kept.settings) ? kept.settings : undefined
}
export function hearSettings(settings: AccountSettings): void {
  const who = account.user?.id
  if (who) keepJson(SETTINGS_HEARD, { who, settings })
}
const only = (settings: AccountSettings, names: string[]): AccountSettings =>
  Object.fromEntries(Object.entries(settings).filter(([name]) => names.includes(name)))
export class AccountOwed {
  sends = 0
  session = 0
  constructor(
    private readonly key: string,
    private readonly landed?: (settings: AccountSettings) => void,
  ) {
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
      base: isRecord(kept.base) ? kept.base : {},
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
    const owed = mine?.patch ?? {}
    const heard = heardSettings()
    const fresh = Object.keys(patch).filter((name) => !(name in owed))
    keepJson(this.key, {
      who: account.user?.id ?? mine?.who ?? null,
      patch: { ...owed, ...patch },
      base: { ...mine?.base, ...(heard ? only(heard, fresh) : {}) },
    })
    const token = account.accountToken
    if (token) void this.settle(token)
  }
  async settle(token: string): Promise<void> {
    const kept = this.mine
    const owed = kept?.patch ?? {}
    if (!Object.keys(owed).length) return
    const session = this.session
    const answer = await this.delivered(token, owed, kept?.base ?? {}, session)
    if (!answer) return
    if (this.session !== session) return
    const mine = this.mine
    const rest = Object.keys(mine?.patch ?? {}).filter(
      (name) => said(mine?.patch[name as keyof AccountSettings]) !== said(owed[name as keyof AccountSettings]),
    )
    if (rest.length) {
      keepJson(this.key, {
        who: mine?.who ?? null,
        patch: only(mine?.patch ?? {}, rest),
        base: only(mine?.base ?? {}, rest),
      })
      return
    }
    forget(this.key)
    if (answer !== true) this.landed?.(answer)
  }
  private async delivered(
    token: string,
    patch: AccountSettings,
    base: AccountSettings,
    session: number,
  ): Promise<AccountSettings | boolean> {
    try {
      return (await api.saveSettings(token, patch, base)).settings
    } catch (error) {
      if (!turnedDown(error)) return false
      const names = Object.keys(patch) as (keyof AccountSettings)[]
      if (names.length < 2) return true
      let last: AccountSettings | boolean = true
      for (const name of names) {
        if (this.session !== session) return true
        const one = await this.delivered(token, only(patch, [name]), base, session)
        if (one === false) return false
        if (one !== true) last = one
      }
      return last
    }
  }
}
