import type { TabKindParts, TabMenuEntry } from '@orden/contracts'
import { iconChoice } from '../../icon-choice.svelte'
import { iconEntries } from '../../menu.svelte'
import { isOnlineTab } from '../../online-terms/src/api'
import { workspace } from '../../workspace.svelte'
import { openOnline, renameTerminal, usageOfTab } from './api'
import { openTerminal, shellRows } from './open'
import { readSpec } from './spec'

const terminalOf = (id: string) =>
  workspace.tabs.find((one) => one.id === id && one.kind === 'terminal') ?? null

function menu(id: string): TabMenuEntry[] {
  const tab = terminalOf(id)
  if (!tab) return []

  if (isOnlineTab(tab)) {
    return [{ label: 'Open another', run: () => void openOnline(true) }, ...iconEntries(tab.path)]
  }

  const spec = readSpec(tab.doc)
  const beside = { folder: spec?.folder ?? null, beside: tab.id }
  return [
    {
      label: 'Open another',
      run: () => void openTerminal(spec?.shell, beside),
      more: () => shellRows((shell) => void openTerminal(shell.id, beside)),
    },
    ...(spec ? [{ label: 'Choose an icon', run: () => iconChoice.terminal(tab.id) }] : []),
  ]
}

export const terminalTabKind: TabKindParts = {
  menu,
  facts: async (id) => {
    const tab = terminalOf(id)
    const usage = tab ? await usageOfTab(tab) : null
    return usage ? { host: null, usage, stream: null } : null
  },
  rename: async (id, name) => {
    const tab = workspace.tabs.find((one) => one.id === id)
    if (tab) await renameTerminal(tab, name)
  },
}
