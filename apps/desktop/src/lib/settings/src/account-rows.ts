import CircleUser from 'lucide/dist/esm/icons/circle-user.mjs'
import CodeXml from 'lucide/dist/esm/icons/code-xml.mjs'
import Info from 'lucide/dist/esm/icons/info.mjs'
import Keyboard from 'lucide/dist/esm/icons/keyboard.mjs'
import LogIn from 'lucide/dist/esm/icons/log-in.mjs'
import LogOut from 'lucide/dist/esm/icons/log-out.mjs'
import Palette from 'lucide/dist/esm/icons/palette.mjs'
import Scale from 'lucide/dist/esm/icons/scale.mjs'
import Settings from 'lucide/dist/esm/icons/settings.mjs'
import Shield from 'lucide/dist/esm/icons/shield.mjs'
import { settingsWindow } from '@orden/contracts'
import { account } from '../../accounts/src/api'
import { openExternal } from '../../platform/src/api'
import { shortcuts } from '../../shortcuts/src/api'
import { DIVIDER, menu, type MenuEntry, viewport } from '../../ui-kit/src/api'
import { SOURCE_URL } from '../../updates/src/api'

const LICENCE_URL = `${SOURCE_URL}/blob/main/LICENSE`
function learnMore(): MenuEntry[] {
  return [
    { label: 'Source code', icon: CodeXml, run: () => void openExternal(SOURCE_URL) },
    {
      label: 'Keyboard shortcuts',
      icon: Keyboard,
      hint: shortcuts.hint('app.keys'),
      run: () => settingsWindow().show('shortcuts'),
    },
    DIVIDER,
    { label: 'Your privacy choices', icon: Shield, run: () => settingsWindow().show('general') },
    { label: 'Licence', icon: Scale, run: () => void openExternal(LICENCE_URL) },
  ]
}
export function accountRows(at: MouseEvent, more: MenuEntry[]): MenuEntry[] {
  return [
    { label: 'Account', icon: CircleUser, run: () => settingsWindow().show('account') },
    {
      label: 'Settings',
      icon: Settings,
      hint: shortcuts.hint('app.settings'),
      run: () => settingsWindow().show(),
    },
    ...(viewport.touch
      ? []
      : [
          {
            label: 'Themes',
            icon: Palette,
            run: () => void import('../../theme-looks/src/api').then((one) => one.pickTheme(at)),
          },
        ]),
    ...more,
    {
      label: 'Learn more',
      icon: Info,
      more: () => Promise.resolve(learnMore()),
      run: () => menu.show(at, learnMore(), { title: 'Learn more' }),
    },
    DIVIDER,
    account.user
      ? { label: 'Sign out', icon: LogOut, run: () => void account.leave() }
      : { label: 'Sign in', icon: LogIn, run: () => (account.open = true) },
  ]
}
