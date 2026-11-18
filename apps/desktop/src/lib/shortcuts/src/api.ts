export type { Preset } from './presets'
export {
  type AppContext,
  BY_ID,
  CATEGORIES,
  FIXED_ENTRIES,
  hearAgain,
  offeredHere,
  runEntry,
  runnable,
  SHORTCUTS,
  type Shortcut,
  showTab,
} from './registry'
export { shortcuts } from './shortcuts.svelte'

export const shortcutPresets = () => import('./presets')

export const doubleTaps = () => import('./tapped')
export { glyphFor, lowMark, markFor, nameFor, toolbar } from './toolbar.svelte'
