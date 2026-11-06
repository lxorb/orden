export const chatsUnread = $state({ any: false })

let kept = false

function keeps(): boolean {
  return kept
}

export function panelKeepsUnread(): void {
  kept = true
}

export async function lookAtLaunch(spaces: readonly string[]): Promise<void> {
  if (kept || !spaces.length) return
  const { listEveryThread, unreadOf } = await import('./chat/threads')
  const heads = await listEveryThread(spaces).catch(() => [])
  if (!keeps()) chatsUnread.any = unreadOf(heads).size > 0
}
