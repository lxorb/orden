import type { Panel } from './session/src/api'
import { chatReveal } from './ai-chat/src/api'

export type PanelTab = Panel | 'scratchpad'

const OPENS: Record<PanelTab, (() => Promise<void>) | null> = {
  tasks: () => import('./todos-entry').then(({ showTodos }) => showTodos()),
  ask: () => chatReveal().then(({ chatToTab }) => chatToTab()),
  scratchpad: () => import('./scratchpad/src/api').then(async (one) => (await one.pad()).asNote()),
  tree: null,
  search: null,
  chats: null,
  time: __EVEN_PLUGIN__
    ? null
    : () =>
        import('./time/src/api').then(({ openTime }) => {
          openTime()
        }),
  outline: null,
  links: null,
}

export function hasTab(id: PanelTab): boolean {
  return OPENS[id] !== null
}

export function openAsTab(id: PanelTab): void {
  void OPENS[id]?.()
}
