import { account } from './account.svelte'
import { api, turnedDown } from './client'
import type { AccountSettings } from './routes'
import { forget, isRecord, keepJson, stored } from '../../platform/src/api'

export class AccountOwed {
  private sent = 0

  constructor(private readonly key: string) {
    account.forgetWithSession(() => forget(this.key))
    account.holdsNoAccount(() => {
      if (this.owner === null) forget(this.key)
    })
  }

  private get owner(): string | null | undefined {
    const kept = stored(this.key)
    if (!isRecord(kept)) return undefined
    return typeof kept.who === 'string' ? kept.who : null
  }

  get standing(): boolean {
    const owner = this.owner
    if (owner === undefined) return false
    const who = account.user?.id ?? null
    return owner === null || who === null || owner === who
  }

  send(patch: AccountSettings): void {
    if (account.noAccountForSure) return
    const who = account.user?.id ?? (this.standing ? this.owner : null) ?? null
    keepJson(this.key, { who })

    const token = account.accountToken
    if (!token) return

    const mine = ++this.sent
    const heard = () => {
      if (this.sent === mine && this.owner === who) forget(this.key)
    }
    void api
      .saveSettings(token, patch)
      .then(heard)
      .catch((error: unknown) => {
        if (turnedDown(error)) heard()
      })
  }
}
