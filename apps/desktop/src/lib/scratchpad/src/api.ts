import type { SidebarPart } from '@orden/contracts'
import { scratchFromDrawer, shown } from './is.svelte'

export {
  SCRATCHPAD,
  closeScratchpad,
  isScratchpad,
  padTab,
  scratchFromDrawer,
  shown,
  toggleScratchpad,
} from './is.svelte'
export const pad = () => import('./pad').then((one) => one.scratchpad)
export const scratchpadHits: typeof import('./hits').scratchpadHits = (...args) =>
  import('./hits').then((one) => one.scratchpadHits(...args))
export const wakeScratchpad = () => import('./start.svelte').then(() => undefined)
export const loadScratchpadCard = () => import('./ScratchpadCard.svelte')
export const scratchpadPart: SidebarPart = {
  id: 'scratchpad',
  open: () => shown.on,
  toggle: scratchFromDrawer,
  toTab: () => pad().then((one) => one.asNote()),
}
