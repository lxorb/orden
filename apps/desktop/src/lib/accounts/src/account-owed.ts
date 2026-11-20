import { account } from './account.svelte'
import { api } from './client'
import type { AccountSettings } from './routes'
import { forget, isRecord, keep, keepJson, stored, storedText } from '../../platform/src/api'

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
    private readonly reset?: () => void,
  ) {
    account.forgetWithSession(() => {
      this.session++
      this.keep(null, null)
    })
    account.holdsNoAccount(() => this.keep(null, null))
  }
  private get owing(): Record<string, Kept> {
    const kept = stored(this.key)
    if (!isRecord(kept)) return {}
    const read = (who: string, one: unknown): Kept | null =>
      isRecord(one) && isRecord(one.patch)
        ? { who: who || null, patch: one.patch, base: isRecord(one.base) ? one.base : {} }
        : null
    const all = isRecord(kept.owed) ? kept.owed : { [typeof kept.who === 'string' ? kept.who : '']: kept }
    return Object.fromEntries(
      Object.entries(all).flatMap(([who, one]) => {
        const held = read(who, one)
        return held ? [[who, held]] : []
      }),
    )
  }
  private keep(who: string | null, kept: { patch: AccountSettings; base: AccountSettings } | null): void {
    const rest = Object.entries(this.owing).filter(([one]) => one !== (who ?? '') && (who === null || one !== ''))
    const owed = Object.fromEntries([
      ...rest.map(([one, { patch, base }]) => [one, { patch, base }] as const),
      ...(kept ? [[who ?? '', kept] as const] : []),
    ])
    if (Object.keys(owed).length) keepJson(this.key, { owed })
    else forget(this.key)
  }
  follows(): void {
    const who = account.user?.id
    if (!who) return
    const holder = storedText(`${this.key}:holder`)
    if (holder === who) return
    if (holder !== null) this.reset?.()
    keep(`${this.key}:holder`, who)
  }
  get mine(): Kept | null {
    return this.held()
  }
  private held(): Kept | null {
    const owing = this.owing
    const who = account.user?.id
    const mine = who ? owing[who] : undefined
    const unknown = owing['']
    if (!mine || !unknown) return mine ?? unknown ?? null
    return { who: mine.who, patch: { ...mine.patch, ...unknown.patch }, base: { ...unknown.base, ...mine.base } }
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
    this.keep(account.user?.id ?? mine?.who ?? null, { patch: { ...mine?.patch, ...patch }, base })
    const token = account.accountToken
    if (token) void this.settle(token)
  }
  async settle(token: string): Promise<void> {
    this.follows()
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
      this.keep(mine.who, { patch: only(mine.patch, rest), base: only(mine.base, rest) })
      return
    }
    this.keep(mine.who, null)
    if (answer !== true) this.landed?.(answer)
  }
}
