export { carry, changeable, trash } from './changes'
export { moved } from './follow'
export { openExplorer } from './open'
export { places } from './places.svelte'
export { showInExplorer } from './reveal'
export { redoOutside, undoOutside } from './undo'
export { viewOf } from './view.svelte'

export const loadExplorerTab = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no file explorer in the Even Realities plugin'))
    : import('./ExplorerTab.svelte')

export const explorerVerbs = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no file explorer in the Even Realities plugin'))
    : import('./agent-verbs').then((one) => one.explorerVerbs)
