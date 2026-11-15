import { chosenIcon, chosenTint } from './chosen-icon'
import { setFileIcon } from './file-icon'
import type { IconTarget } from './icon-choice.svelte'
import { readSpec, setTerminalIcon } from './terminal/src/api'
import { workspace } from './workspace/src/api'

function terminalTab(id: string) {
  const tab = workspace.tabs.find((one) => one.id === id)
  return tab?.kind === 'terminal' && readSpec(tab.doc) ? tab : null
}

export function wornBy(target: IconTarget): string | null {
  if (target.kind === 'pass') return target.worn
  if (target.kind === 'space') return workspace.iconFor(target.id)
  if (target.kind === 'terminal') {
    const tab = terminalTab(target.tab)
    return (tab && readSpec(tab.doc)?.icon) ?? null
  }
  return chosenIcon(target.path)
}

export function tintOf(target: IconTarget): string | null {
  if (target.kind === 'pass') return null
  if (target.kind === 'space') return workspace.tintFor(target.id)
  if (target.kind === 'terminal') {
    const tab = terminalTab(target.tab)
    return (tab && readSpec(tab.doc)?.iconColor) ?? null
  }
  return chosenTint(target.path)
}

export function wear(target: IconTarget, icon: string | null, colour: string | null): void {
  if (target.kind === 'pass') target.take(icon)
  else if (target.kind === 'space') workspace.setIcon(target.id, icon, colour)
  else if (target.kind === 'folder') workspace.setFolderIcon(target.path, icon, colour)
  else if (target.kind === 'terminal') setTerminalIcon(target.tab, icon, colour)
  else void setFileIcon(target.path, icon, colour)
}
