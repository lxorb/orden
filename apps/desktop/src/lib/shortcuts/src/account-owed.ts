import { account, api, type AccountSettings } from '../../accounts/src/api'
import { forget, keepJson, stored } from '../../platform/src/api'

export class AccountOwed {
  private sent = 0

  constructor(private readonly key: string) {}

  get standing(): boolean {
    const who = account.user?.id
    return !!who && stored(this.key) === who
  }

  send(patch: AccountSettings): void {
    const token = account.accountToken
    const who = account.user?.id
    if (!token || !who) return

    const mine = ++this.sent
    keepJson(this.key, who)
    void api
      .saveSettings(token, patch)
      .then(() => {
        if (this.sent === mine && stored(this.key) === who) forget(this.key)
      })
      .catch(() => undefined)
  }
}
