export { quickAdd } from './asked.svelte'
export type { Prefill } from './entry'
export { priorityTone } from './labels'

export const loadQuickAddSheet = () =>
  __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./QuickAddSheet.svelte')

export const loadQuickAddWindow = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no quick add window in the Even Realities plugin'))
    : import('./Window.svelte')

export const quickShortcuts = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no quick add shortcuts in the Even Realities plugin'))
    : import('./shortcuts')

export const quickAnywhere = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no quick add anywhere in the Even Realities plugin'))
    : import('./anywhere.svelte')
