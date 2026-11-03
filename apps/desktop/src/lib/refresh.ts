/** What "reload" means wherever the reader is (#1065): one place, the pull's and the
 *  palette's alike. A web tab in front reloads its page; anything else - a note, the
 *  file list, the sidebar, tasks, chats - syncs now, pulling what the other devices
 *  wrote, and shows it as it lands. Never the app rebuilt and never an unsaved word
 *  thrown away: a sync pass sends what is typed before it reads what came. Answers once
 *  the page has been asked again or the pass has run, which is how long the pull's
 *  mark keeps turning; see pull.svelte.ts. */

import { workspace } from './workspace.svelte'

export async function refreshHere(): Promise<void> {
  const tab = workspace.active
  if (tab?.kind === 'web') {
    const { pages } = await import('./web-tab/pages.svelte')
    await pages.step(tab.id, 'reload')
    return
  }
  const { sync } = await import('./sync.svelte')
  await sync.pass()
  if (sync.status === 'error' || sync.status === 'offline') {
    throw new Error(sync.lastError ?? 'sync failed')
  }
}
