import { account } from './account.svelte'
import { t } from './i18n.svelte'
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
      { label: t('Account'), run: () => settings.show('account') },
      { label: t('Settings'), hint: shortcuts.hint('app.settings'), run: () => settings.show() },
      ...more,
      DIVIDER,
      account.user
        ? { label: t('Sign out'), run: leave }
        : { label: t('Sign in'), run: () => (account.open = true) },
    ],
    { title: account.user?.email ?? t('Account'), up },
  )
}
