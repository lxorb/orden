import { portOf } from '@orden/contracts'
import type { Tab } from '../../documents/src/api'
import { samePath } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { folderIn, terminalWords } from './twin'
import { viewOf } from './view.svelte'

export const turnLabel = (tab: Tab): string =>
  workspace.twinOf(tab.id)?.kind === 'terminal' ? 'Back to the terminal' : 'Terminal here'
export function turnTab(tab: Tab): Tab | null {
  const view = viewOf(tab)
  const twin = workspace.twinOf(tab.id)
  const shown = twin
    ? workspace.turn(tab.id)
    : workspace.turn(tab.id, { kind: 'terminal', words: terminalWords(view.folder), title: 'Terminal' })
  if (!shown) return null
  view.tuck()
  const folder = view.folder
  if (twin && folder && !samePath(folderIn(shown.doc), folder)) void cdThere(shown, folder)
  return shown
}
function cdThere(shown: Tab, folder: string): Promise<boolean> {
  const going = portOf('terminal.going')
  return going.ok ? going.value.goTo(shown.id, folder).catch(() => false) : Promise.resolve(false)
}
export function turnExplorer() {
  const tab = workspace.active
  if (tab?.kind === 'explorer') turnTab(tab)
}
