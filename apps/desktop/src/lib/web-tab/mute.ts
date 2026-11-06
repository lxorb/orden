import { invoke } from '../tauri'
import { type Page, pages } from './pages.svelte'
import { siteOf } from './permissions.svelte'
import { asideFor, isMuted, setMuted } from './sites'

export function mute(tabId: string, page: Page, muted: boolean): void {
  page.muted = muted
  void invoke('web_mute', { tab: tabId, muted }).catch(() => undefined)
}

export async function muteSite(tabId: string, muted: boolean): Promise<void> {
  const site = siteOf(pages.addressOf(tabId))
  if (!site) return

  const page = pages.of(tabId)
  const aside = asideFor(tabId, page)
  if (aside !== undefined) {
    setMuted(site, muted, aside)
    mute(tabId, page, muted)
    return
  }

  setMuted(site, muted)
  const { workspace } = await import('../workspace.svelte')
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'web' || siteOf(pages.addressOf(tab.id)) !== site) continue
    const one = pages.of(tab.id)
    mute(tab.id, one, isMuted(site, asideFor(tab.id, one)))
  }
}
