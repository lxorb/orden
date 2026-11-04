/** Going between the panes by key and by pointer (#1033).
 *
 *  **Alt+H, J, K and L**, vim's four ways, take the focus to the pane next over on that
 *  side, and the keyboard with it: the key says where the hand is going next. Which pane
 *  is next over is pane-tree.ts (`paneToward`), by where the panes sit in the window. None
 *  on a Mac, where Option and a letter types a character, as with the tabs' Alt and a
 *  digit; and inside a terminal Alt and a letter is the shell's (terminal/keys.ts). Taken
 *  from a web page as well, so they reach the app with the keyboard in a site; see
 *  `web_keys_take` in web_keys.rs and tab-strip/numbers.svelte.ts.
 *
 *  **The pane under the pointer is the active one**, by default (Settings, Appearance):
 *  the one Alt and a digit counts along and a new tab opens in. The keyboard goes along
 *  only where the pane being left was not being typed in, so a line half written is never
 *  carried into a pane the pointer drifted over: a note, a field or a page holding the
 *  keyboard keeps it until a press or a key moves it. Over a web page the app's own page
 *  hears no pointer, so there the pane follows once the pointer crosses its strip or bar,
 *  and a press in the page chooses it (#1080). */

import { tabOverview } from './surfaces.svelte'
import { invoke, isDesktop } from './tauri'
import { IN_A_PAGE } from './trap'
import type { Toward } from './workspace/pane-tree'
import { workspace } from './workspace.svelte'

/** The pane next over on that side, with the keyboard in it. */
export function movePane(toward: Toward): void {
  const next = workspace.panes.focusToward(toward)
  if (next) keyboardInto(next.id)
}

/** The keyboard put into what a pane shows: its page, its note, its terminal. */
export function keyboardInto(paneId: string): void {
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

/** Whether the keyboard stays where it is as the pointer leaves a pane: it is in a web
 *  page, which may be a field; or somewhere that is not that pane at all - the sidebar,
 *  a dialog - and no pane's to move; or in that pane where a person types. Only nothing
 *  holding it, or a button or a list in the pane left, lets it go along. */
export function keyboardStays(leaving: string): boolean {
  if (document.documentElement.hasAttribute(IN_A_PAGE)) return true

  const at = document.activeElement
  if (!(at instanceof HTMLElement) || at === document.body) return false
  if (!at.closest(`[data-pane="${CSS.escape(leaving)}"]`)) return true

  // A terminal's field is a textarea; a note is CodeMirror's editable line box.
  return (
    at.isContentEditable || at.closest('input, textarea, select, [contenteditable="true"]') !== null
  )
}

let following = false

/** Listens for the pointer crossing into another pane, once. */
export function followPointer(): void {
  if (following) return
  following = true

  addEventListener('pointermove', (event) => followed(event), { capture: true, passive: true })
}

function followed(event: PointerEvent) {
  if (!workspace.device.paneFollowsPointer) return
  // A finger has no hover, and a button held is a drag or a selection being made.
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
