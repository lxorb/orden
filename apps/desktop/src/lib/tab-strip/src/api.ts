export {
  spaceDropping,
  stripMenus,
  tabLetters,
  tabMenus,
  tabNumbers,
  tabOps,
  tabToSpace,
  tabUnloading,
} from './shell-parts'
export type { ClosingWidths } from './closing.svelte'
export { flushFirst } from './flush'
export { fitTabs, iconTabs } from './icon-tabs.svelte'
export type { Block } from './picking.svelte'
export { PREVIEW_DELAY, previewDelay } from './preview-delay.svelte'
export { default as Tabs } from './Tabs.svelte'
export { unloadTabs } from './unload-choice.svelte'

export const noteMenus = () => import('./note-menu')
