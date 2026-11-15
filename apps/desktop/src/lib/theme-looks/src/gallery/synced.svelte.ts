import { untrack } from 'svelte'
import { theme } from '../../../theme/src/api'
import { forget, keep, storedText } from '../../../platform/src/api'
import { LookSync } from './look-sync'

const OWED_KEY = 'orden:look-owed'

let started = false

export async function syncLook(): Promise<void> {
  if (started) return
  started = true

  const [{ account, api }, { hub }] = await Promise.all([
    import('../../../accounts/src/api'),
    import('../../../sync-client/src/api'),
  ])

  const looks = new LookSync({
    token: () => account.accountToken,
    look: () => theme.look(),
    wear: (look) => theme.wearLook(look),
    read: async (token) => (await api.settings(token)).settings,
    save: (token, look) => api.saveSettings(token, { look }),
    owedKept: () => storedText(OWED_KEY) === 'yes',
    keepOwed: (owed) => (owed ? keep(OWED_KEY, 'yes') : forget(OWED_KEY)),
  })

  const adopt = () => {
    const token = account.accountToken
    if (token) void looks.adopt(token)
  }

  theme.picked(() => looks.picked())
  account.forgetWithSession(() => looks.forget())
  hub.on('settings', adopt)
  hub.opened(adopt)
  $effect.root(() => {
    $effect(() => {
      const token = account.accountToken
      untrack(() => {
        if (token) void looks.adopt(token)
      })
    })
  })
}
