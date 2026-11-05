/** What each thing an icon is chosen for wears, and where a new one is written: the one
 *  table the icon picker reads, so a kind of target added is a branch here and never a
 *  branch in every place the picker asks. See icon-choice.svelte.ts for the targets. */

import { chosenIcon, chosenTint } from './chosen-icon'
import { setFileIcon } from './file-icon'
import type { IconTarget } from './icon-choice.svelte'
import { readSpec, writeSpec } from './terminal/spec'
import { workspace } from './workspace.svelte'

/** The terminal tab a target names, where it is still open and on this machine. */
function terminalTab(id: string) {
  const tab = workspace.tabs.find((one) => one.id === id)
  return tab?.kind === 'terminal' && readSpec(tab.doc) ? tab : null
}

/** The icon it wears now, as written; null for none. */
export function wornBy(target: IconTarget): string | null {
  if (target.kind === 'space') return workspace.iconFor(target.id)
  if (target.kind === 'terminal') {
    const tab = terminalTab(target.tab)
    return (tab && readSpec(tab.doc)?.icon) ?? null
  }
  return chosenIcon(target.path)
}

/** The colour that icon is drawn in; null for the plain foreground. */
export function tintOf(target: IconTarget): string | null {
  if (target.kind === 'space') return workspace.tintFor(target.id)
  if (target.kind === 'terminal') {
    const tab = terminalTab(target.tab)
    return (tab && readSpec(tab.doc)?.iconColor) ?? null
  }
  return chosenTint(target.path)
}

/** Writes `icon` and its colour where the target keeps them, or takes them away for null. */
export function wear(target: IconTarget, icon: string | null, colour: string | null): void {
  if (target.kind === 'space') workspace.setIcon(target.id, icon, colour)
  else if (target.kind === 'folder') workspace.setFolderIcon(target.path, icon, colour)
  else if (target.kind === 'terminal') setTerminalIcon(target.tab, icon, colour)
  else void setFileIcon(target.path, icon, colour)
}

/** A terminal on this machine wearing an icon over what runs in it (#1110): kept in its
 *  tab's words, which carry it through a restart and Reopen closed tab, as its name is;
 *  see terminal/rename.ts. */
export function setTerminalIcon(id: string, icon: string | null, colour: string | null): void {
  const tab = terminalTab(id)
  const spec = tab ? readSpec(tab.doc) : null
  if (!tab || !spec) return
  const plain = { shell: spec.shell, folder: spec.folder, key: spec.key, name: spec.name }
  const worn = icon === null ? plain : { ...plain, icon, ...(colour ? { iconColor: colour } : {}) }
  tab.note.replace(writeSpec(worn), false)
  workspace.scheduleSession()
}
