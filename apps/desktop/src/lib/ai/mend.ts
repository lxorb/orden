/** An account kept on a model nobody can talk to, moved to the one a key given now would
 *  start on (#325). Its list is read once at a time; where it cannot be, the model stays
 *  as it was and is tried again the next time the accounts are read. Only over the model
 *  it was read with: one picked meanwhile is the reader's. */

import { log } from '../log'
import { type Accounts, resolve } from './accounts'
import { listModels } from './complete'
import { firstModel } from './providers'
import { stuck } from './stuck'

/** What of the store this needs: its accounts as they stand, and a change to one. */
interface Store {
  readonly state: Accounts
  update(id: string, change: { model: string }): void
}

/** The accounts being asked about now. */
const asking = new Set<string>()

export function mend(store: Store, state: Accounts): void {
  for (const account of state.accounts) {
    const { id, kind, model } = account
    if (!stuck(account) || asking.has(id)) continue
    const provider = resolve(state, id)
    if (!provider) continue
    asking.add(id)
    void listModels(provider)
      .then((found) => {
        const first = firstModel(kind, found)
        const now = store.state.accounts.find((one) => one.id === id)
        if (first && now?.model === model) store.update(id, { model: first })
      })
      .catch((error: unknown) => {
        log('warn', `ai accounts: could not move ${id} off ${model}: ${String(error)}`)
      })
      .finally(() => asking.delete(id))
  }
}
