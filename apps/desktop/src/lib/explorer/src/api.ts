export { carry, changeable, renamePath, trash } from './changes'
export { listFolder, makeIn } from './commands'
export { moved } from './follow'
export { inASpace, openExplorer } from './open'
export { places } from './places.svelte'
export { showInExplorer } from './reveal'
export { redoOutside, undoOutside } from './undo'
export { type ExplorerView, viewOf } from './view.svelte'

export const loadExplorerTab = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no file explorer in the Even Realities plugin'))
    : import('./ExplorerTab.svelte')
