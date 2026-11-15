import { account } from '../../accounts/src/api'
import { DIVIDER, menu, type MenuEntry } from '../../ui-kit/src/api'
import { settingsWindow } from '@orden/contracts'
import { shortcuts } from '../../shortcuts/src/api'

export function showAccount(event: MouseEvent, more: MenuEntry[] = [], up = true) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const at = new MouseEvent('contextmenu', {
    clientX: up ? box.left : box.right,
    clientY: up ? box.top : box.bottom,
  })
  menu.show(
    at,
    [
      { label: 'Account', run: () => settingsWindow().show('account') },
      {
        label: 'Settings',
        hint: shortcuts.hint('app.settings'),
        run: () => settingsWindow().show(),
      },
      ...more,
      DIVIDER,
      account.user
        ? { label: 'Sign out', run: () => void account.leave() }
        : { label: 'Sign in', run: () => (account.open = true) },
    ],
    { title: account.user?.email ?? 'Account', up },
  )
}
