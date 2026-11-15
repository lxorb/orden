import './shell-parts'
import { type TabKind, tabKindLoaded } from '@orden/contracts'
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

export const tabMenus = async (kind?: TabKind) => {
  const [menus] = await Promise.all([import('./menu'), kind && tabKindLoaded(kind)])
  return menus
}

export const stripMenus = () => import('./strip-menu')

export const tabClosing = () => import('./closing.svelte')

export const loadTabChip = () => import('./TabChip.svelte')

export const loadTabNameField = () => import('./TabNameField.svelte')

export const tabCarrying = () => import('./carrying')

export const essentialDropping = () => import('./essential-drop')

export const tabOps = () => import('./ops')

export const tabPicking = () => import('./picking.svelte')

export const hoverCards = () => import('./hover-card.svelte')

export const tabLetters = () => import('./letters.svelte')

export const tabNumbers = () => import('./numbers.svelte')

export const tabUnloading = () => import('./unloading.svelte')

export const tabToSpace = () => import('./to-space')

export const spaceDropping = () => import('./space-drop')
