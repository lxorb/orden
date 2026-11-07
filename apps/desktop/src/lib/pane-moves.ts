import { tabOverview } from './surfaces.svelte'
import { invoke, isDesktop } from './tauri'
import { IN_A_PAGE } from './trap'
import type { Toward } from './workspace/pane-tree'
import { workspace } from './workspace.svelte'

export function movePane(toward: Toward): void {
  const next = workspace.panes.focusToward(toward)
  if (next) keyboardInto(next.id)
}

function keyboardInto(paneId: string): void {
  const tab = workspace.showing(paneId)
  if (tab?.kind === 'web' && isDesktop) {
    void invoke('keyboard_back', { tab: tab.id }).catch(() => undefined)
    return
  }

  const box = document.querySelector<HTMLElement>(`[data-pane="${CSS.escape(paneId)}"]`)
  const into =
    box?.querySelector<HTMLElement>('.cm-content, .xterm textarea, [data-entry]') ??
    box?.querySelector<HTMLElement>(
      '[tabindex="0"], button, input, textarea, [contenteditable="true"]',
    )
  into?.focus()
}

export function keyboardStays(leaving: string): boolean {
  if (document.documentElement.hasAttribute(IN_A_PAGE)) return true

  const at = document.activeElement
  if (!(at instanceof HTMLElement) || at === document.body) return false
  if (!at.closest(`[data-pane="${CSS.escape(leaving)}"]`)) return true

  return (
    at.isContentEditable || at.closest('input, textarea, select, [contenteditable="true"]') !== null
  )
}

let following = false

export function followPointer(): void {
  if (following) return
  following = true

  addEventListener('pointermove', (event) => followed(event), { capture: true, passive: true })
}

function followed(event: PointerEvent) {
  if (!workspace.device.paneFollowsPointer) return
  if (event.pointerType === 'touch' || event.buttons !== 0) return
  if (workspace.panes.count < 2 || workspace.panes.dragging || tabOverview.open) return

  const box =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-pane]') : null
  const id = box?.dataset.pane
  const leaving = workspace.panes.focusedId
  if (!id || id === leaving) return

  const stays = keyboardStays(leaving)
  workspace.focusPane(id)
  if (!stays) keyboardInto(id)
}
