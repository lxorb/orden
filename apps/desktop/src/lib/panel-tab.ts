/** Every panel in one table the compiler holds complete, so a new panel is asked each
 *  question by the type rather than left out by a list: whether it opens as a tab of
 *  its own and how, and beside which tabs it has anything to show.
 *
 *  As a tab: what a double press on its icon in a side's row of tabs opens (#1110), and
 *  the "Open in new tab" row of its icon's menu. Todos opens the space's one view of
 *  its tasks, as its key does; Ask moves the conversation into a tab, as its own menu's
 *  row does; the scratchpad opens as the note it is. The rest are about the note in
 *  front, or the space's tree, and are a side's alone. Each fetched with the press, so
 *  the first paint carries none of them.
 *
 *  Beside which tabs (#1120): a panel about the space - the files, the search, the
 *  tasks, the chats, Ask - fills beside anything. A panel about the tab in front is
 *  offered where that tab's kind says it can be (`panels` in workspace/tab-kinds.ts)
 *  and what it holds gives it something to show: the Outline beside a Markdown note
 *  with headings or footnotes, a page note, or a PDF that wrote its own contents - and
 *  not beside a terminal, a web page, a canvas, an application, or a note with no parts
 *  to list; the Links beside what a note can link to. */

import type { Panel } from './workspace.svelte'
import { TAB_KINDS, type TabKind, type TabPanel } from './workspace/tab-kinds'

export type PanelTab = Panel | 'scratchpad'

/** What the tab in front holds, as far as the panels about it ask. */
export interface Filling {
  kind: TabKind
  /** Whether its words are Markdown: a code file opens as a note too, and has none. */
  markdown: boolean
  /** How many headings, footnotes and rows of its own contents it has. */
  headings: number
  footnotes: number
  contents: number
}

interface Entry {
  /** Opens it as a tab, or null where it has none. */
  tab: (() => Promise<void>) | null
  /** Whether it has something to show beside this tab; null for a panel about the
   *  space, which has beside anything. */
  fills: ((tab: Filling) => boolean) | null
}

/** Whether the tab's kind says it fills this panel. */
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
  // A page note's pages are its parts whatever is drawn on them; a note's are its
  // headings and its footnotes, and a PDF's the contents it wrote.
  outline: {
    tab: null,
    fills: (tab) =>
      declared('outline', tab) &&
      (tab.kind === 'pages' ||
        (tab.kind === 'pdf' ? tab.contents > 0 : tab.markdown && tab.headings + tab.footnotes > 0)),
  },
  links: { tab: null, fills: (tab) => declared('links', tab) },
}

/** Whether a panel opens as a tab. */
export function hasTab(id: PanelTab): boolean {
  return PANELS[id].tab !== null
}

/** Opens a panel as its tab; nothing for one that has none. */
export function openAsTab(id: PanelTab): void {
  void PANELS[id].tab?.()
}

/** Whether a panel has something to show beside the tab in front. With no tab in front
 *  there is nothing to tell the panels apart by, so each is offered as it always was and
 *  says for itself that no note is open; and a panel this build does not have is
 *  offered nowhere. */
export function fills(id: PanelTab, tab: Filling | null): boolean {
  const entry = PANELS[id] as Entry | undefined
  if (!entry) return false
  return entry.fills === null || tab === null || entry.fills(tab)
}
