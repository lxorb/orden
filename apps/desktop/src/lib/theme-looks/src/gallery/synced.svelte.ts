import { untrack } from 'svelte'
import { FIRST_LOOK, SHARED, theme } from '../../../theme/src/api'
import { LookSync } from './look-sync'
import { OwedMark } from './owed-mark'

const HOLDER = 'orden:look-holder'
let started = false
export async function syncLook(): Promise<void> {
  if (started) return
  started = true
  const [{ account, api, turnedDown }, { hub }, { forget, keep, keepJson, stored, storedText }] = await Promise.all([
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
    who: () => account.user?.id ?? null,
    holder: {
      read: () => storedText(HOLDER),
      write: (who) => keep(HOLDER, who),
    },
    plain: () => ({
      theme: FIRST_LOOK.theme,
      scheme: 'system',
      values: { [SHARED]: { accent: FIRST_LOOK.accent } },
      css: '',
    }),
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
