export {
  essentialDropping,
  hoverCards,
  loadTabChip,
  spaceDropping,
  stripMenus,
  tabCarrying,
  tabClosing,
  tabLetters,
  tabMenus,
  tabNameField,
  tabNumbers,
  tabOps,
  tabPicking,
  tabToSpace,
  tabUnloading,
} from './shell-parts'
export type { ClosingWidths } from './closing.svelte'
export { arrival, handOver, keyOf, picks, register, stripOf, TabDrag } from './drag.svelte'
export { flushFirst, flushStart } from './flush'
export { fitTabs, iconTabs } from './icon-tabs.svelte'
export {
  type Bounds,
  crossTakes,
  endOf,
  fitted,
  holds,
  keptWidths,
  MAGNETISM,
  moved,
  OPENING,
  partsFor,
  placed,
  PLUS,
  PLUS_GAP,
  plusFits,
  separated,
  slotAt,
  trailing,
  widened,
  widthsFor,
  worthKeeping,
} from './layout'
export type { Block } from './picking.svelte'
export { PREVIEW_DELAY, previewDelay } from './preview-delay.svelte'
export { revealed } from './scroll'
export { default as Tabs } from './Tabs.svelte'
export { initialOf, siteLook, twins } from './twins'
export { unloadTabs } from './unload-choice.svelte'
export { wheelAlong } from './wheel'

export const noteMenus = () => import('./note-menu')
