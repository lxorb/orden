import type { TabKindParts } from '@orden/contracts'

export const loadViewTab = () => import('./ViewTab.svelte')
export const startRunner = (): Promise<void> => import('./runner.svelte').then(() => undefined)
export const baseOpening = () => import('./open')
export const baseMounting = () => import('./mount')
export const rowsCopied = () => import('./copied')
const todosEntry = () => import('./todos-entry')
export const createDatabase: typeof import('./new-database').createDatabase = (...args) =>
  import('./new-database').then((one) => one.createDatabase(...args))
export const pickTemplate: typeof import('./templates').pickTemplate = () =>
  import('./templates').then((one) => one.pickTemplate())
export const viewCommands = {
  'views.new-database': () => void createDatabase(),
  'views.pick-template': () => void pickTemplate(),
  'views.todos': () => void todosEntry().then(({ showTodos }) => showTodos()),
}
export const orderMoved: typeof import('./order-paths').orderMoved = (...args) =>
  import('./order-paths').then((one) => one.orderMoved(...args))
export const viewTabKind: TabKindParts = {
  open: async (path, how) => {
    ;(await baseOpening()).openBaseFile(path, how)
  },
  make: (folder, name) => createDatabase(folder, name),
}
