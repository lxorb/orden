import { registerCommand, type TabKind, tabKindLoaded } from '@orden/contracts'
import { door } from '@orden/markdown/door'
import { closeWindow, isDesktop, platform } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { picks } from './drag.svelte'

const active = () => workspace.activeTabId ?? ''

function close(): void {
  const pick = picks.loaded
  const many = pick?.chosen.of(workspace.panes.focusedId) ?? []
  if (pick && many.length) void pick.closeChosen(many)
  else if (workspace.activeTabId || workspace.tabs.length || !isDesktop || platform() !== 'macos')
    void workspace.closeActive()
  else void closeWindow()
}

registerCommand('app.close', () => Promise.resolve(close))
registerCommand('app.duplicate-tab', async () => {
  const { duplicateTab } = await import('./ops')
  return () => duplicateTab(active())
})
registerCommand('pane.move-tab', async () => {
  const { moveToOtherPane } = await import('./ops')
  return () => moveToOtherPane(active())
})

export const tabMenus = async (kind?: TabKind) => {
  const [menus] = await Promise.all([import('./menu'), kind && tabKindLoaded(kind)])
  return menus
}

export const stripMenus = () => import('./strip-menu')

export const tabClosing = () => import('./closing.svelte')

export const loadTabChip = () => import('./TabChip.svelte')

export const tabNameField = door(() => import('./TabNameField.svelte').then((one) => one.default))

export const tabCarrying = () => import('./carrying')

export const essentialDropping = () => import('./essential-drop')

export const tabOps = () => import('./ops')

export const tabPicking = () => import('./picking.svelte')

export const hoverCards = () => import('./hover-card.svelte')

export const tabLetters = () => import('./letters.svelte')

export const tabNumbers = () => import('./numbers.svelte')

export const tabUnloading = () => import('./unloading.svelte')

export const tabToSpace = () => import('./to-space')

export const spaceDropping = () => import('./space-drop')
