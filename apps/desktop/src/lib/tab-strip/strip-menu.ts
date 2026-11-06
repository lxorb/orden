import { t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu-item'
import { shortcuts } from '../shortcuts.svelte'
import { workspace } from '../workspace.svelte'

export function stripMenu(paneId: string): MenuEntry[] {
  const inFront = workspace.panes.at(paneId)?.activeTabId ?? ''

  return [
    {
      label: t('New tab'),
      hint: shortcuts.hint('app.new-kind'),
      run: () => workspace.newTab(paneId),
    },
    {
      label: t('Reopen closed tab'),
      hint: shortcuts.hint('app.reopen'),
      disabled: !workspace.closed.any,
      run: () => {
        workspace.focusPane(paneId)
        void workspace.reopenClosed()
      },
    },
    DIVIDER,
    {
      label: t('Close all tabs'),
      hint: shortcuts.hint('app.close-all'),
      disabled: workspace.closesAround(inFront, 'all') === 0,
      run: () => void workspace.closeAround(inFront, 'all'),
    },
  ]
}
