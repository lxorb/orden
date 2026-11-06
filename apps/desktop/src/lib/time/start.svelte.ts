import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { RECONCILE_INTERVAL } from '../backoff'
import { timeDevice } from './device'
import { accountServer } from './server'
import { time } from './time.svelte'

$effect.root(() => {
  $effect(() => {
    const owner = account.user?.id ?? null
    const token = account.accountToken
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
  const again = () => {
    if (document.visibilityState === 'visible') void time.exchange()
  }
  document.addEventListener('visibilitychange', again)
  window.addEventListener('online', again)
  setInterval(again, RECONCILE_INTERVAL)
}
