/** Whether any chat of the AI panel has an answer the reader has not seen (#1064), for
 *  the ✦ tab's dot: the side reads it without loading the panel. At launch it is read
 *  from the chats' heads (`lookAtLaunch`), so the dot is right before the panel has ever
 *  been opened; once the panel's store is loaded it keeps it (sidebar/chat.svelte.ts). */

export const chatsUnread = $state({ any: false })

/** Whether the panel's store keeps `chatsUnread` now. */
let kept = false

/** Whether the panel keeps it, read through a call: it may have been loaded while the
 *  heads were read. */
function keeps(): boolean {
  return kept
}

/** The panel's store is loaded and keeps the dot from here on. */
export function panelKeepsUnread(): void {
  kept = true
}

/** The dot as the kept chats say it, before the panel is loaded: their heads only, read
 *  with the threads' own module fetched on its own, not the panel's code. */
export async function lookAtLaunch(spaces: readonly string[]): Promise<void> {
  if (kept || !spaces.length) return
  const { listEveryThread, unreadOf } = await import('./chat/threads')
  const heads = await listEveryThread(spaces).catch(() => [])
  if (!keeps()) chatsUnread.any = unreadOf(heads).size > 0
}
