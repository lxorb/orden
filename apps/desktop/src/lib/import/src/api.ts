export type { Carried } from './carry'
export { converted } from './convert'
export { folderNameFor, onMac } from './folder-name'
export { dayOf, noteText } from './meta'
export { safeName, titleFrom } from './names'
export type { ImportPlan, Planned } from './plan'
export { detect, readAs } from './read'
export { insideFolder, pickedFolder, type Source, sourcesFrom, tooMuch } from './sources'
export { vaults } from './vaults'
export const macNotes = () => import('./apple')
export const bringing = () => import('./bring')
export const todoistAccount = () => import('./todoist')
export const importingStore = () => import('./importing.svelte')
const migratingStore = () => import('./migrating.svelte')
export const loadMigrateRows = () => import('./MigrateRows.svelte')
export const loadImportSheet = () => import('./ImportSheet.svelte')
export const loadImportTab = () => import('./ImportTab.svelte')
export const loadImportMark = () => import('./ImportMark.svelte')
async function showImport() {
  const { importing } = await importingStore()
  importing.show()
}
async function convertSyntax() {
  await (await import('./convert-syntax')).convertSyntax()
}
async function migrate(from: 'obsidian' | 'files' | 'zen') {
  const { migrating } = await migratingStore()
  await migrating[from]()
}
export const importCommands = {
  'import.show': () => void showImport(),
  'import.obsidian': () => void migrate('obsidian'),
  'import.notion': () => void migrate('files'),
  'import.zen': () => void migrate('zen'),
  'import.convert-syntax': () => void convertSyntax(),
}
export { landShared, readShared } from './shared'
