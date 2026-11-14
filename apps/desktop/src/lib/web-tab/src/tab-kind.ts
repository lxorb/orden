import type { TabKindParts, TabMenuEntry } from '@orden/contracts'
import { shortcuts } from '../../shortcuts.svelte'
import { copyText } from '../../ui-controls/src/api'
import { workspace } from '../../workspace.svelte'
import { muteSite } from './mute'
import { pages } from './pages.svelte'

function menu(id: string): TabMenuEntry[] {
  const tab = workspace.tabs.find((one) => one.id === id)
  if (tab?.kind !== 'web') return []

  const url = pages.addressOf(tab.id) ?? tab.address ?? null
  return [
    {
      label: 'Reload',
      disabled: url === null,
      run: () => void pages.step(tab.id, 'reload'),
    },
    {
      label: 'Copy link',
      disabled: url === null,
      run: () => {
        if (url !== null) void copyText(url)
      },
    },
    {
      label: pages.of(tab.id).muted ? 'Unmute site' : 'Mute site',
      hint: shortcuts.hint('web.mute'),
      disabled: url === null,
      run: () => void muteSite(tab.id, !pages.of(tab.id).muted),
    },
  ]
}

export const webTabKind: TabKindParts = { menu }
