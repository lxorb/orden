/** A panel as a tab of its own: what a double press on its icon in a side's row of tabs
 *  opens (#1110), and the "Open in new tab" row of its icon's menu. Every panel says, in
 *  one table the compiler holds complete, whether it has a tab and how it opens, so a
 *  new panel is asked the question by the type rather than left out by a list.
 *
 *  Todos opens the space's one view of its tasks, as its key does; Ask moves the
 *  conversation into a tab, as its own menu's row does; the scratchpad opens as the note
 *  it is. The rest are about the note in front, or the space's tree, and are a side's
 *  alone. Each fetched with the press, so the first paint carries none of them. */

import type { Panel } from './workspace.svelte'

export type PanelTab = Panel | 'scratchpad'

const TABS: Record<PanelTab, (() => Promise<void>) | null> = {
  tasks: () => import('./todos-entry').then(({ showTodos }) => showTodos()),
  ask: () => import('./ai/sidebar/reveal').then(({ chatToTab }) => chatToTab()),
  scratchpad: () => import('./scratchpad/pad').then(({ scratchpad }) => scratchpad.asNote()),
  tree: null,
  outline: null,
  search: null,
  chats: null,
  links: null,
}

/** Whether a panel opens as a tab. */
export function hasTab(id: PanelTab): boolean {
  return TABS[id] !== null
}

/** Opens a panel as its tab; nothing for one that has none. */
export function openAsTab(id: PanelTab): void {
  void TABS[id]?.()
}
