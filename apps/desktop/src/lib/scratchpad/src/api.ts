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

export const wakeScratchpad = () =>
  __EVEN_PLUGIN__ ? Promise.resolve() : import('./start.svelte').then(() => undefined)

export const loadScratchpadCard = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('not in the plugin'))
    : import('./ScratchpadCard.svelte')
