import type { Tab } from '../../documents/src/api'
import { workspace } from '../../workspace/src/api'
import { terminalWords } from './twin'
import { viewOf } from './view.svelte'

export const turnLabel = (tab: Tab): string =>
  workspace.twinOf(tab.id)?.kind === 'terminal' ? 'Back to the terminal' : 'Terminal here'
export function turnTab(tab: Tab): Tab | null {
  const view = viewOf(tab)
  const shown = workspace.twinOf(tab.id)
    ? workspace.turn(tab.id)
    : workspace.turn(tab.id, { kind: 'terminal', words: terminalWords(view.folder), title: 'Terminal' })
  if (shown) view.tuck(shown.doc)
  return shown
}
export function turnExplorer() {
  const tab = workspace.active
  if (tab?.kind === 'explorer') turnTab(tab)
}
