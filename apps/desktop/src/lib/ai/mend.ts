import { log } from '../platform/src/api'
import { type Accounts, resolve } from './accounts'
import { listModels } from './complete'
import { firstModel } from './providers'
import { stuck } from './stuck'

interface Store {
  readonly state: Accounts
  update(id: string, change: { model: string }): void
}

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
