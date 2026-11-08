import { account } from '../../account.svelte'
import { t } from '../../i18n.svelte'
import { DIVIDER, menu } from '../../menu.svelte'
import { pass } from '../store.svelte'
import type { PassUi } from '../ui.svelte'

export function showPassAccount(event: MouseEvent, ui: PassUi): void {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const at = new MouseEvent('contextmenu', { clientX: box.left, clientY: box.top })
  menu.show(
    at,
    [
      { label: t('Settings'), run: () => void ui.goTo('settings') },
      DIVIDER,
      { label: t('Sign out'), run: () => void signOut() },
    ],
    { until: pass.opened, title: account.user?.email ?? t('Account'), up: true },
  )
}

async function signOut(): Promise<void> {
  pass.lock()
  await account.signOut('asked')
}
