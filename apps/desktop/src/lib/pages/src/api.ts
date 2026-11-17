import type { SidebarPart } from '@orden/contracts'
import { pages } from './showing.svelte'

export { pages }

const away = <T>(): Promise<T> => new Promise<never>(() => undefined)

export const loadPages = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./Pages.svelte')>() : import('./Pages.svelte')

export const loadNavigator = () =>
  __EVEN_PLUGIN__
    ? away<typeof import('./PagesNavigator.svelte')>()
    : import('./PagesNavigator.svelte')

export const pagesOut = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no page notes in the Even Realities plugin'))
    : import('./out')

export const pdfTabs = () => import('./pdf-tabs')

export const outlinePart: SidebarPart = {
  id: 'outline',
  covers: () => pages.current !== null,
}
