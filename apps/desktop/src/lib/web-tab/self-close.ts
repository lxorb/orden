/** Closes the tab a page opened for a file once the file has started, and puts the reader
 *  back on the page that asked; see `downloaded` in pages.svelte.ts.
 *
 *  A page that closes takes the keyboard with it when it had it, and nothing else of the
 *  app's gives it back, so the app's own page takes it when the tab was on screen - as a
 *  menu row or a bubble over a web tab does; see take-keyboard.ts. A tab behind the one on
 *  screen never had it. Loaded with the first download rather than the first paint. */

import { takeKeyboard } from '../take-keyboard'

export async function closeItself(tab: string, opener: string): Promise<void> {
  const { workspace } = await import('../workspace.svelte')
  const shown = workspace.activeTabId === tab
  if (workspace.tabs.some((one) => one.id === opener)) workspace.activate(opener)
  workspace.close(tab)
  if (shown) void takeKeyboard()
}
