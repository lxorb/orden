import { type ZoomStep } from './bar-keys'
import { zoomed } from './menu'
import { type Page, pages } from './pages.svelte'
import { siteOf } from './permissions.svelte'
import { asideFor, keepZoom } from './sites'

export function zoomTo(tabId: string, page: Page, factor: number): void {
  page.zoom = factor
  keepZoom(siteOf(page.url), factor, asideFor(tabId, page))
  void pages.zoom(tabId, factor)
}

export function zoomStep(tabId: string, page: Page, step: ZoomStep): void {
  zoomTo(tabId, page, step === 'reset' ? 1 : zoomed(page.zoom, step === 'in'))
}
