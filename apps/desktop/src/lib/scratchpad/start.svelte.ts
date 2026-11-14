import { untrack } from 'svelte'
import { account } from '../accounts/src/api'
import { RECONCILE_INTERVAL, inTurn, log, afterQuiet } from '../platform/src/api'
import { padDisk } from './disk'
import { padTab, shown } from './is.svelte'
import { scratchpad } from './pad'
import { accountPad } from './server'
import { PadSync } from './sync'

const AFTER_WRITING = 1_500
const WHILE_SHOWN = 30_000
const PATIENCE = 60_000

const sync = new PadSync(scratchpad, padDisk(), (name, run) => inTurn(() => name, run, PATIENCE))

let going: Promise<unknown> | null = null
let again = false
let signedInAs: string | null = null

function exchange(): void {
  const owner = account.user?.id ?? null
  const token = account.accountToken
  if (!owner || !token) return
  signedInAs = owner
  if (going) {
    again = true
    return
  }
  going = sync
    .exchange(owner, accountPad(token))
    .catch((error: unknown) =>
      log('info', `scratchpad: not traded with the account: ${String(error)}`),
    )
    .finally(() => {
      going = null
      if (!again) return
      again = false
      exchange()
    })
}

scratchpad.listen(afterQuiet(exchange, AFTER_WRITING))

account.forgetWithSession(() => {
  const owner = signedInAs
  signedInAs = null
  if (owner) void sync.left(owner).catch(() => undefined)
})

$effect.root(() => {
  $effect(() => {
    if (account.user?.id && account.accountToken) untrack(exchange)
  })
  $effect(() => {
    if (shown.on) untrack(exchange)
  })
})

if (typeof window !== 'undefined') {
  const visible = () => document.visibilityState === 'visible'
  const soon = () => {
    if (visible()) exchange()
  }
  document.addEventListener('visibilitychange', soon)
  window.addEventListener('online', soon)
  setInterval(() => {
    if (visible() && (shown.on || padTab())) exchange()
  }, WHILE_SHOWN)
  setInterval(soon, RECONCILE_INTERVAL)
}
