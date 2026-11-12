import { account } from './account.svelte'
import { DIVIDER, menu, type MenuEntry } from './menu.svelte'
import { settings } from './settings.svelte'
import { shortcuts } from './shortcuts.svelte'

export function showAccount(event: MouseEvent, more: MenuEntry[] = [], up = true) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const at = new MouseEvent('contextmenu', {
    clientX: up ? box.left : box.right,
    clientY: up ? box.top : box.bottom,
  })
  const leave = () =>
    __EVEN_PLUGIN__
      ? void account.signOut('asked')
      : void import('./ai/vault/leaving').then((one) => one.signOut())
  menu.show(
    at,
    [
      { label: 'Account', run: () => settings.show('account') },
      { label: 'Settings', hint: shortcuts.hint('app.settings'), run: () => settings.show() },
      ...more,
      DIVIDER,
      account.user
        ? { label: 'Sign out', run: leave }
        : { label: 'Sign in', run: () => (account.open = true) },
    ],
    { title: account.user?.email ?? 'Account', up },
  )
}
