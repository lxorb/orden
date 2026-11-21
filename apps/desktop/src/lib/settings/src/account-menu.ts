import { account } from '../../accounts/src/api'
import { menu, type MenuEntry } from '../../ui-kit/src/api'

export function showAccount(event: MouseEvent, more: MenuEntry[] = [], up = true) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const at = new MouseEvent('contextmenu', {
    clientX: up ? box.left : box.right,
    clientY: up ? box.top : box.bottom,
  })
  void import('./account-rows').then(({ accountRows }) =>
    menu.show(at, accountRows(at, more), { title: account.user?.email ?? 'Account', up }),
  )
}
