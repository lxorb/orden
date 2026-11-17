import { DIVIDER, type MenuEntry } from '../../ui-kit/src/api'
import { shortcuts } from '../../shortcuts/src/api'
import { workspace } from '../../workspace/src/api'

export function stripMenu(paneId: string): MenuEntry[] {
  return [
    {
      label: 'New tab',
      hint: shortcuts.hint('app.new-kind'),
      run: () => workspace.newTab(paneId),
    },
    {
      label: 'Reopen closed tab',
      hint: shortcuts.hint('app.reopen'),
      disabled: !workspace.closed.any,
      run: () => {
        workspace.focusPane(paneId)
        void workspace.reopenClosed()
      },
    },
    DIVIDER,
    {
      label: 'Close all tabs',
      hint: shortcuts.hint('app.close-all'),
      disabled: workspace.closesAllIn(paneId) === 0,
      run: () => void workspace.closeAllIn(paneId),
    },
  ]
}
