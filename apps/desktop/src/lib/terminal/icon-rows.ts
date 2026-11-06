import { t } from '../i18n.svelte'
import { iconChoice } from '../icon-choice.svelte'
import { iconEntries, type MenuEntry } from '../menu.svelte'
import { isOnlineTab } from '../online/path'
import type { Tab } from '../workspace.svelte'
import { readSpec } from './spec'

export function terminalIconRows(tab: Tab): MenuEntry[] {
  if (tab.kind !== 'terminal') return []
  if (isOnlineTab(tab)) return iconEntries(tab.path)

  const spec = readSpec(tab.doc)
  if (!spec) return []
  return [
    { label: t('Choose an icon'), run: () => iconChoice.terminal(tab.id) },
    ...(spec.icon
      ? [
          {
            label: t('Remove icon'),
            run: () =>
              void import('../icon-target').then((one) => one.setTerminalIcon(tab.id, null, null)),
          },
        ]
      : []),
  ]
}
