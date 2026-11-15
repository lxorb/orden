import type { TabKindParts, TabMenuEntry } from '@orden/contracts'
import { iconChoice } from '../../icon-choice.svelte'
import { iconEntries } from '../../menu-entries'
import { isOnlineTab } from '../../online-terms/src/api'
import { workspace } from '../../workspace/src/api'
import { openOnline, openTerm, renameTerminal, usageOfTab } from './api'
import { setTerminalIcon } from './icon'
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

const specOf = (id: string) => {
  const tab = terminalOf(id)
  return tab ? readSpec(tab.doc) : null
}

export const terminalTabKind: TabKindParts = {
  open: async (path, how) => {
    await openTerm(path, how)
  },
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
  icon: {
    worn: (id) => specOf(id)?.icon ?? null,
    tint: (id) => specOf(id)?.iconColor ?? null,
    wear: setTerminalIcon,
  },
}
