import { untrack } from 'svelte'
import { account } from '../../accounts/src/api'
import { RECONCILE_INTERVAL } from '../../platform/src/api'
import { forgetSessionOwner, sessionOwner } from '../../session-owner'
import { timeDevice } from './device'
import { timeOn } from '../../settings.svelte'
import { accountServer } from './server'
import { time } from './time.svelte'

account.forgetWithSession(forgetSessionOwner)

$effect.root(() => {
  $effect(() => {
    const owner = sessionOwner(account)
    const token = account.token
    untrack(
      () =>
        void time.opened({
          owner,
          server: owner && token ? accountServer(token) : null,
          device: timeDevice(),
        }),
    )
  })
})

if (typeof window !== 'undefined') {
  void import('./sense.svelte')
  void import('./reminding')
  const again = () => {
    if (timeOn() && document.visibilityState === 'visible') void time.exchange()
  }
  document.addEventListener('visibilitychange', again)
  window.addEventListener('online', again)
  setInterval(again, RECONCILE_INTERVAL)
}
