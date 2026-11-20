import { explorerOn } from '../../gates/src/api'
import { isOnlineTab } from '../../online-terms/src/api'
import { nameOf } from '../../platform/src/api'
import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { hostIdOf, readSpec } from './spec'

export function turnable(tab: Tab): boolean {
  if (!explorerOn() || isOnlineTab(tab)) return false
  const shell = readSpec(tab.doc)?.shell ?? ''
  return hostIdOf(shell) === null && !shell.startsWith('wsl:')
}
export function turnLabel(tab: Tab): string {
  return workspace.twinOf(tab.id)?.kind === 'explorer' ? 'Back to the file explorer' : 'Show in file explorer'
}
export function turnTerminal(tab: Tab): void {
  if (!turnable(tab)) return
  if (workspace.twinOf(tab.id)) {
    workspace.turn(tab.id)
    return
  }
  const folder = readSpec(tab.doc)?.folder ?? workspace.activeSpace?.root ?? null
  if (!folder) return
  const words = JSON.stringify({ folder, back: [], ahead: [] })
  workspace.turn(tab.id, { kind: 'explorer', words, title: nameOf(folder) })
}
export function turnActive(): void {
  const tab = workspace.active
  if (tab?.kind === 'terminal') turnTerminal(tab)
}
