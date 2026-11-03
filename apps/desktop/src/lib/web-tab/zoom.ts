/** Drawing a page larger or smaller, whichever way it was asked: the bar's keys, the
 *  dots, or the Mac's View rows, which is the only way a key reaches the app there while
 *  a page has the keyboard (#397). The engine says nothing about a zoom it was told to
 *  make, only one made in the page, so this one is kept for the site here. */

import { type ZoomStep } from './bar-keys'
import { zoomed } from './menu'
import { type Page, pages } from './pages.svelte'
import { siteOf } from './permissions.svelte'
import { asideFor, keepZoom } from './sites'

/** Draws a tab's page at `factor`. */
export function zoomTo(tabId: string, page: Page, factor: number): void {
  page.zoom = factor
  keepZoom(siteOf(page.url), factor, asideFor(tabId, page))
  void pages.zoom(tabId, factor)
}

/** A rung of a tab's page's zoom, or back to a hundred per cent. */
export function zoomStep(tabId: string, page: Page, step: ZoomStep): void {
  zoomTo(tabId, page, step === 'reset' ? 1 : zoomed(page.zoom, step === 'in'))
}
