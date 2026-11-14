export type { Preset } from './presets'
export {
  type AppContext,
  BY_ID,
  CATEGORIES,
  FIXED_ENTRIES,
  hearAgain,
  runEntry,
  runnable,
  SHORTCUTS,
  type Shortcut,
  showTab,
} from './registry'
export { shortcuts } from './shortcuts.svelte'

export const shortcutPresets = () => import('./presets')
