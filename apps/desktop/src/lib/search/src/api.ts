export { selectedWords } from './seed'
export { type Found, searchSpace } from './space'
export { search, searchFrom, showSearch } from './panel.svelte'

export type Warming = (typeof import('./warm.svelte'))['warm']

export const searchWarmth = () => import('./warm.svelte').then((one) => one.warm)

export const changesFor: typeof import('./apply').changesFor = (...args) =>
  import('./apply').then((one) => one.changesFor(...args))

export const loadSearchPanel = () => import('./SearchPanel.svelte')
