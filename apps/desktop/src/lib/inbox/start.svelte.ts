import { ACCOUNT_INBOX } from '@orden/bases/inbox'
import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { links } from '../link-index.svelte'
import { homeRoot } from '../rows/home.svelte'
import { forgetSessionOwner, sessionOwner } from '../session-owner'
import { insideSpace } from '../space-paths'
import { keep, storedText } from '../stored'
import { accountInbox } from './account.svelte'
import { inboxServer } from './server'

const LOOK_AGAIN = 60_000

const DEVICE = 'orden:inbox-device'

function device(): string {
  const held = storedText(DEVICE)
  if (held) return held
  const made = crypto.randomUUID().replace(/-/g, '')
  keep(DEVICE, made)
  return made
}

export function inboxPath(): string | null {
  const home = homeRoot()
  return home === null ? null : insideSpace(home, ACCOUNT_INBOX)
}

let soon: ReturnType<typeof setTimeout> | undefined

async function told(): Promise<void> {
  const path = inboxPath()
  if (path === null) return
  const text = await accountInbox.text().catch(() => null)
  if (text !== null) links.noteSaved(path, text, true)
}

accountInbox.hear(() => {
  clearTimeout(soon)
  soon = setTimeout(() => void told(), 0)
})

account.forgetWithSession(forgetSessionOwner)

$effect.root(() => {
  $effect(() => {
    const owner = sessionOwner(account)
    const token = account.token
    untrack(
      () =>
        void accountInbox.opened({
          owner,
          server: owner && token ? inboxServer(token) : null,
          device: device(),
        }),
    )
  })
})

if (typeof window !== 'undefined') {
  const again = () => {
    if (document.visibilityState === 'visible') void accountInbox.exchange()
  }
  document.addEventListener('visibilitychange', again)
  window.addEventListener('online', again)
  window.addEventListener('focus', again)
  setInterval(again, LOOK_AGAIN)
}
