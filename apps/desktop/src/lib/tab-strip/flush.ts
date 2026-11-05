import { panesIn, topRow } from '../workspace/pane-tree'
import { workspace } from '../workspace.svelte'

export function flushStart(paneId: string): boolean {
  const { panes } = workspace
  if (panes.count < 2 || panes.fills) return false
  if (panesIn(topRow(panes.frame))[0]?.id === paneId) return false
  const tabs = workspace.tabsIn(paneId)
  return !(workspace.showing(paneId) && tabs.some((one) => one.trail.length > 1))
}

export function flushFirst(paneId: string): boolean {
  const first = workspace.tabsIn(paneId)[0]
  return !!first && first.id === workspace.panes.at(paneId)?.activeTabId && flushStart(paneId)
}
