import { account } from '../../accounts/src/api'
import { DIVIDER, menu, type MenuEntry, viewport } from '../../ui-kit/src/api'
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
      ...(viewport.touch
        ? []
        : [
            {
              label: 'Themes',
              run: () => void import('../../theme-looks/src/api').then((one) => one.pickTheme(at)),
            },
          ]),
      ...more,
      DIVIDER,
      account.user
        ? { label: 'Sign out', run: () => void account.leave() }
        : { label: 'Sign in', run: () => (account.open = true) },
    ],
    { title: account.user?.email ?? 'Account', up },
  )
}
