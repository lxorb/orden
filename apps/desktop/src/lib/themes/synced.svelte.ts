import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { api } from '../api'
import { hub } from '../sync-client/src/api'
import { theme } from '../theme.svelte'
import { LookSync } from './look-sync'

const looks = new LookSync({
  token: () => account.accountToken,
  look: () => theme.look(),
  wear: (look) => theme.wearLook(look),
  read: async (token) => (await api.settings(token)).settings,
  save: (token, look) => api.saveSettings(token, { look }),
})

let started = false

export function syncLook(): void {
  if (started) return
  started = true

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
