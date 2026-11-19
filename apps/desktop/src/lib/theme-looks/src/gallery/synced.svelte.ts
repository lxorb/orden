import { untrack } from 'svelte'
import { theme } from '../../../theme/src/api'
import { LookSync } from './look-sync'
import { OwedMark } from './owed-mark'

let started = false
export async function syncLook(): Promise<void> {
  if (started) return
  started = true
  const [{ account, api, turnedDown }, { hub }, { forget, keepJson, stored }] = await Promise.all([
    import('../../../accounts/src/api'),
    import('../../../sync-client/src/api'),
    import('../../../platform/src/api'),
  ])
  const looks = new LookSync({
    owing: new OwedMark('orden:look-owed', account, {
      read: stored,
      write: keepJson,
      drop: forget,
    }),
    token: () => account.accountToken,
    look: () => theme.look(),
    wear: (look) => theme.wearLook(look),
    read: async (token) => (await api.settings(token)).settings,
    save: (token, look) =>
      api.saveSettings(token, { look }).catch((error: unknown) => {
        if (!turnedDown(error)) throw error
      }),
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
