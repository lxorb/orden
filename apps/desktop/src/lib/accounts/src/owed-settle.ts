import { api, turnedDown } from './client'
import { type AccountOwed, only } from './account-owed'
import type { AccountSettings } from './routes'

export async function retried(
  owed: AccountOwed,
  token: string,
  kept: { patch: AccountSettings; base: AccountSettings },
  session: number,
  error: unknown,
): Promise<AccountSettings | boolean> {
  if (!turnedDown(error)) return false
  const names = Object.keys(kept.patch)
  if (names.length < 2) return true
  let last: AccountSettings | boolean = true
  for (const name of names) {
    if (owed.session !== session) return true
    const patch = only(kept.patch, [name])
    const one = await api.saveSettings(token, patch, kept.base).then(
      (answer): AccountSettings | boolean => answer.settings,
      (failed: unknown) => retried(owed, token, { patch, base: kept.base }, session, failed),
    )
    if (one === false) return false
    if (one !== true) last = one
  }
  return last
}
