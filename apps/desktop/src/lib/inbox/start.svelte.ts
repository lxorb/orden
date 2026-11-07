import { ACCOUNT_INBOX, isAccountInbox } from '@orden/bases/inbox'
import { untrack } from 'svelte'
import { account } from '../account.svelte'
import { links } from '../link-index.svelte'
import { homeRoot } from '../rows/home.svelte'
import { insideSpace } from '../space-paths'
import { internal } from '../tauri'
import { keep, storedText } from '../stored'
import { accountInbox } from './account.svelte'
import { inboxServer } from './server'

const LOOK_AGAIN = 60_000

const refused = () => Promise.reject(new Error('the inbox is kept by the account, not in a file'))

internal.answered = (command, args) => {
  const path = args?.path
  if (typeof path !== 'string' || !isAccountInbox(path)) return null
  switch (command) {
    case 'read_note':
      return accountInbox.text()
    case 'write_note':
      return accountInbox
        .write(typeof args?.content === 'string' ? args.content : '')
        .then(() => null)
    case 'file_stamp':
      return accountInbox.stamp()
    case 'path_exists':
    case 'file_there':
      return Promise.resolve(true)
    case 'snapshot_note':
    case 'let_go_note':
      return Promise.resolve(null)
    default:
      return refused()
  }
}

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

$effect.root(() => {
  $effect(() => {
    const owner = account.user?.id ?? null
    const token = account.accountToken
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
