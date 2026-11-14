export { default as PassWeb } from './web/PassWeb.svelte'

export const loadPassTab = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no Pass in the Even Realities plugin'))
    : import('./PassTab.svelte')

export const loadPassFill = () =>
  __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./PassFill.svelte')
