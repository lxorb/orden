export { applyImport } from './apply'
export {
  BROWSER_LOGOS,
  type BrowserId,
  type BrowserProfile,
  type FoundBrowser,
  foundBrowsers,
  ZEN_LOGO,
} from './browsers'
export { landBrowser } from './browser-landing'
export { type Carried, carriedBy } from './carry'
export { converted } from './convert'
export { folderNameFor, onMac } from './folder-name'
export { dayOf, noteText } from './meta'
export { safeName, titleFrom } from './names'
export type { FormatId, ImportPlan, Planned } from './plan'
export { detect, readAs } from './read'
export { insideFolder, pickedFolder, type Source, sourcesFrom, tidyPath, tooMuch } from './sources'
export { type Vault, vaults, vaultSources } from './vaults'
export { landZen } from './zen-landing'
export { type ZenProfile, zenProfiles } from './zen-profiles'

export const macNotes = () => import('./apple')

export const todoistAccount = () => import('./todoist')

export const importingStore = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no import in the Even Realities plugin'))
    : import('./importing.svelte')

export const loadImportSheet = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no import in the Even Realities plugin'))
    : import('./ImportSheet.svelte')
