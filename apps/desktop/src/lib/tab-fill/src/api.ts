export { toggleFill } from './fill'

const away = <T>(): Promise<T> => new Promise<never>(() => undefined)

export const loadFillBar = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./FillBar.svelte')>() : import('./FillBar.svelte')
