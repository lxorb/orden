import { workspace } from '../../workspace/src/api'

const AWAY = 0.35
const TURN = 48

export function tabsAway(dx: number, wide: number): boolean {
  return wide > 0 && Math.abs(dx) > wide * AWAY
}

export function turnOf(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < TURN || Math.abs(dx) < Math.abs(dy) * 2) return 0
  return dx < 0 ? 1 : -1
}

export function turnTab(dx: number, dy: number): boolean {
  const turn = turnOf(dx, dy)
  if (!turn) return false
  const tabs = workspace.tabsIn(workspace.panes.focusedId)
  const at = tabs.findIndex((one) => one.id === workspace.activeTabId)
  const next = at < 0 ? undefined : tabs[at + turn]
  if (!next) return false
  workspace.activate(next.id)
  return true
}
