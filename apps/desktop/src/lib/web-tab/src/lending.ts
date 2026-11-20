import type { WebLent } from '@orden/contracts'
import { awayFrom, inSight, OUT_OF_THE_WAY, pages, type Page, type Rect } from './pages.svelte'

const UNSEEN: Rect = { x: 0, y: 0, width: 1280, height: 800 }
export async function aside(tabId: string, page: Page, pane: Rect): Promise<void> {
  await pages.put(tabId, page, awayFrom(pane))
  await page.shooting
  if (!page.onScreen && !page.lent) await pages.place(tabId, pane, false)
}
export async function lend(tabId: string, as: WebLent): Promise<void> {
  const page = pages.of(tabId)
  page.url ??= as.url
  page.space ??= as.space
  page.path = as.path
  if (!page.live) page.own = as.own
  page.lent = true
  while (page.opening) await new Promise((go) => setTimeout(go, 50))
  if (page.onScreen || page.url === null) return
  const pane = page.pane ?? UNSEEN
  if (page.live) {
    await pages.thaw(tabId)
    if (!inSight(page)) await aside(tabId, page, pane)
    return
  }
  await pages.build(tabId, page, { ...pane, x: -OUT_OF_THE_WAY, y: -OUT_OF_THE_WAY }, true)
  if (inSight(page)) return
  page.pane = pane
  page.shown = false
}
export function unlend(tabId: string): void {
  const page = pages.each().find(([id]) => id === tabId)?.[1]
  if (!page?.lent) return
  page.lent = false
  if (!page.onScreen && page.pane) pages.hide(tabId, page.pane)
}
