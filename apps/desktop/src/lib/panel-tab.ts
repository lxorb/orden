import type { Panel } from './workspace.svelte'
import { TAB_KINDS, type TabKind, type TabPanel } from './workspace/tab-kinds'

export type PanelTab = Panel | 'scratchpad'

export interface Filling {
  kind: TabKind
  markdown: boolean
  headings: number
  footnotes: number
  contents: number
}

interface Entry {
  tab: (() => Promise<void>) | null
  fills: ((tab: Filling) => boolean) | null
}

const declared = (panel: TabPanel, tab: Filling): boolean =>
  (TAB_KINDS[tab.kind].panels as readonly TabPanel[]).includes(panel)

const PANELS: Record<PanelTab, Entry> = {
  tasks: { tab: () => import('./todos-entry').then(({ showTodos }) => showTodos()), fills: null },
  ask: {
    tab: () => import('./ai/sidebar/reveal').then(({ chatToTab }) => chatToTab()),
    fills: null,
  },
  scratchpad: {
    tab: () => import('./scratchpad/pad').then(({ scratchpad }) => scratchpad.asNote()),
    fills: null,
  },
  tree: { tab: null, fills: null },
  search: { tab: null, fills: null },
  chats: { tab: null, fills: null },
  outline: {
    tab: null,
    fills: (tab) =>
      declared('outline', tab) &&
      (tab.kind === 'pages' ||
        (tab.kind === 'pdf' ? tab.contents > 0 : tab.markdown && tab.headings + tab.footnotes > 0)),
  },
  links: { tab: null, fills: (tab) => declared('links', tab) },
}

export function hasTab(id: PanelTab): boolean {
  return PANELS[id].tab !== null
}

export function openAsTab(id: PanelTab): void {
  void PANELS[id].tab?.()
}

export function fills(id: PanelTab, tab: Filling | null): boolean {
  const entry = PANELS[id] as Entry | undefined
  if (!entry) return false
  return entry.fills === null || tab === null || entry.fills(tab)
}
