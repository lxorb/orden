import { account } from '../../accounts/src/api'
import { DIVIDER, menu } from '../../menu.svelte'
import { pass } from '../store.svelte'
import type { PassUi } from '../ui.svelte'

export function showPassAccount(event: MouseEvent, ui: PassUi): void {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const at = new MouseEvent('contextmenu', { clientX: box.left, clientY: box.top })
  menu.show(
    at,
    [
      { label: 'Settings', run: () => void ui.goTo('settings') },
      DIVIDER,
      { label: 'Sign out', run: () => void signOut() },
    ],
    { until: pass.opened, title: account.user?.email ?? 'Account', up: true },
  )
}

async function signOut(): Promise<void> {
  pass.lock()
  await account.signOut('asked')
}
