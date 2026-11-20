import type { SidebarPart } from '@orden/contracts'
import { pages } from './showing.svelte'

export { pages }
export const loadPages = () => import('./Pages.svelte')
export const loadNavigator = () => import('./PagesNavigator.svelte')
export const pagesOut = () => import('./out')
export const pdfTabs = () => import('./pdf-tabs')
export const outlinePart: SidebarPart = {
  id: 'outline',
  covers: () => pages.current !== null,
}
