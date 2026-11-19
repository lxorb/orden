import { chosenIcon, chosenTint } from '../../marks/src/api'
import { setFileIcon } from './file-icon'
import type { IconTarget } from './icon-choice.svelte'
import { tabKindParts } from '@orden/contracts'
import { workspace } from '../../workspace/src/api'

const terminalIcon = () => tabKindParts('terminal').icon
export function wornBy(target: IconTarget): string | null {
  if (target.kind === 'pass') return target.worn
  if (target.kind === 'space') return workspace.iconFor(target.id)
  if (target.kind === 'terminal') return terminalIcon()?.worn(target.tab) ?? null
  return chosenIcon(target.path)
}
export function tintOf(target: IconTarget): string | null {
  if (target.kind === 'pass') return null
  if (target.kind === 'space') return workspace.tintFor(target.id)
  if (target.kind === 'terminal') return terminalIcon()?.tint(target.tab) ?? null
  return chosenTint(target.path)
}
export function wear(target: IconTarget, icon: string | null, colour: string | null): void {
  if (target.kind === 'pass') target.take(icon)
  else if (target.kind === 'space') workspace.setIcon(target.id, icon, colour)
  else if (target.kind === 'folder') workspace.setFolderIcon(target.path, icon, colour)
  else if (target.kind === 'terminal') terminalIcon()?.wear(target.tab, icon, colour)
  else void setFileIcon(target.path, icon, colour)
}
