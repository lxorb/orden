export { applyImport } from './apply'
export { foundBrowsers } from './browsers'
export { landBrowser } from './browser-landing'
export type { Carried } from './carry'
export { converted } from './convert'
export { folderNameFor, onMac } from './folder-name'
export { dayOf, noteText } from './meta'
export { safeName, titleFrom } from './names'
export type { ImportPlan, Planned } from './plan'
export { detect, readAs } from './read'
export { insideFolder, pickedFolder, type Source, sourcesFrom, tidyPath, tooMuch } from './sources'
export { vaults, vaultSources } from './vaults'
export { landZen } from './zen-landing'
export { zenProfiles } from './zen-profiles'

export const macNotes = () => import('./apple')

export const bringing = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no import in the Even Realities plugin'))
    : import('./bring')

export const todoistAccount = () => import('./todoist')

export const importingStore = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no import in the Even Realities plugin'))
    : import('./importing.svelte')

export const migratingStore = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no import in the Even Realities plugin'))
    : import('./migrating.svelte')

export const loadMigrateRows = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no import in the Even Realities plugin'))
    : import('./MigrateRows.svelte')

export const loadImportSheet = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no import in the Even Realities plugin'))
    : import('./ImportSheet.svelte')
