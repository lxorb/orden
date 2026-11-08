import { agentMarks } from '../agent-marks.svelte'
import { invoke } from '../tauri'
import type { Page } from './pages.svelte'
import { grants, siteOf } from './permissions.svelte'
import { FROZEN_AFTER, overCap, rest as judged, type Resting } from './resting'
import { saver } from './saver.svelte'

export interface Held {
  each(): [string, Page][]
  peek(tabId: string): Page | undefined
  park(tabId: string, hidden?: boolean): Promise<void>
}

function resting(id: string, page: Page): Resting {
  const site = siteOf(page.url)
  const allowed = (ask: 'camera' | 'microphone' | 'notifications') =>
    grants.said(site, ask, page.inPrivate) === 'allow'
  return {
    id,
    live: page.live,
    onScreen: page.onScreen,
    frozen: page.frozen,
    looked: page.looked,
    loading: page.loading,
    playing: page.playing,
    heard: page.heard,
    acting: id in agentMarks.on || page.lent,
    calling: allowed('camera') || allowed('microphone'),
    notifying: allowed('notifications'),
    edited: page.edited,
    inPrivate: page.inPrivate,
  }
}

export function rest(pages: Held, tabId: string, refused = false): void {
  const page = pages.peek(tabId)
  if (!page?.live || page.onScreen) return
  const one = resting(tabId, page)

  clearTimeout(page.resting)
  page.resting = undefined
  const { act, again } = refused
    ? { act: null, again: FROZEN_AFTER }
    : judged(one, saver.mode, Date.now())
  if (act === 'park') {
    void pages.park(tabId, true)
    return
  }
  if (act === 'freeze') void lull(pages, tabId, page, true)
  if (again !== null) page.resting = setTimeout(() => rest(pages, tabId), again)
}

export function lull(pages: Held, tabId: string, page: Page, paused: boolean): Promise<void> {
  page.frozen = paused
  page.lulling = page.lulling.then(async () => {
    if (paused) await page.shooting
    const done = await invoke<boolean | undefined>('web_pause', { tab: tabId, paused }).catch(
      () => false,
    )
    if (!paused || done !== false || !page.frozen) return
    page.frozen = false
    rest(pages, tabId, true)
  })
  return page.lulling
}

export function bound(pages: Held): void {
  const all = pages.each().map(([id, page]) => resting(id, page))
  for (const id of overCap(all, saver.mode, Date.now())) void pages.park(id, true)
}
