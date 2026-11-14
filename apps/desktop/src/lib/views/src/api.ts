export { builtinName, readSpec, writeSpec } from './spec'

const away = <T>(): Promise<T> => new Promise<never>(() => undefined)

export const loadViewTab = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./ViewTab.svelte')>() : import('./ViewTab.svelte')

export const startRunner = (): Promise<void> =>
  __EVEN_PLUGIN__ ? Promise.resolve() : import('./runner.svelte').then(() => undefined)

export const baseOpening = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./open')>() : import('./open')

export const baseMounting = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./mount')>() : import('./mount')

export const rowsCopied = () => import('./copied')

export const createDatabase: typeof import('./new-database').createDatabase = (...args) =>
  import('./new-database').then((one) => one.createDatabase(...args))

export const pickTemplate: typeof import('./templates').pickTemplate = () =>
  import('./templates').then((one) => one.pickTemplate())

export const orderMoved: typeof import('./order-paths').orderMoved = (...args) =>
  import('./order-paths').then((one) => one.orderMoved(...args))
