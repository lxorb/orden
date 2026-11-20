import { account } from './account.svelte'
import { api } from './client'
import type { AccountSettings } from './routes'
import { forget, isRecord, keepJson, stored } from '../../platform/src/api'

interface Kept {
  who: string | null
  patch: AccountSettings
  base: AccountSettings
}
export const SETTINGS_HEARD = 'orden:settings-heard'
type Name = keyof AccountSettings
const said = (value: unknown) => JSON.stringify(value)
export const only = (settings: AccountSettings, names: string[]): AccountSettings =>
  Object.fromEntries(Object.entries(settings).filter(([name]) => names.includes(name)))
export function heardSettings(): AccountSettings | undefined {
  const kept = stored(SETTINGS_HEARD)
  const who = account.user?.id
  return isRecord(kept) && who && kept.who === who && isRecord(kept.settings) ? kept.settings : undefined
}
export class AccountOwed {
  sends = 0
  session = 0
  constructor(
    readonly key: string,
    readonly landed?: (settings: AccountSettings) => void,
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
  get mine(): Kept | null {
    return this.held()
  }
  private held(): Kept | null {
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
    const base: Record<string, unknown> = { ...mine?.base }
    const heard = heardSettings() ?? {}
    for (const name of Object.keys(patch) as (keyof AccountSettings)[]) {
      if (!mine || !(name in mine.patch)) base[name] = heard[name]
    }
    keepJson(this.key, { who: account.user?.id ?? mine?.who ?? null, patch: { ...mine?.patch, ...patch }, base })
    const token = account.accountToken
    if (token) void this.settle(token)
  }
  async settle(token: string): Promise<void> {
    const kept = this.mine
    if (!kept || !Object.keys(kept.patch).length) return
    const session = this.session
    const answer = await api.saveSettings(token, kept.patch, kept.base).then(
      (one): AccountSettings | boolean => one.settings,
      async (error: unknown) => (await import('./owed-settle')).retried(this, token, kept, session, error),
    )
    if (!answer || this.session !== session) return
    const mine = this.held() ?? kept
    const rest = Object.keys(mine.patch).filter(
      (name) => said(mine.patch[name as Name]) !== said(kept.patch[name as Name]),
    )
    if (rest.length) {
      keepJson(this.key, { who: mine.who, patch: only(mine.patch, rest), base: only(mine.base, rest) })
      return
    }
    forget(this.key)
    if (answer !== true) this.landed?.(answer)
  }
}
