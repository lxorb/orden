/** How wide the sidebar is, and the drag along its edge that changes it.
 *
 *  A habit of the machine rather than of the account: a laptop and a wide
 *  monitor want different widths, so this is kept here and never synced. Null
 *  means the default from the theme tokens, which is also what a double click
 *  on the edge puts back. */

import { isNumber, stored } from './stored'
import { viewport } from './viewport.svelte'

const STORAGE_KEY = 'nib:sidebar-width'
const NARROWEST = 180
const WIDEST = 520

function saved(): number | null {
  const width = stored(STORAGE_KEY)
  return isNumber(width) && width >= NARROWEST && width <= WIDEST ? width : null
}

/** Writes the width down, or does not. `stored` already answers nothing for a
 *  browser told to keep no site data; the setter throws outright there, and a
 *  width nobody can remember is not worth failing a drag over. */
function keep(width: number | null) {
  try {
    if (width === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(width))
  } catch {
    // As above: the sidebar is the width it is, just not after a restart.
  }
}

/** One step of an arrow key. A whole row's worth rather than a pixel: a hand
 *  moving the edge with a key is placing the panel, not measuring it. */
const STEP = 16

export class SidebarWidth {
  /** The two ends, for the handle to say where along them it is. */
  readonly narrowest = NARROWEST
  readonly widest = WIDEST

  /** Null means the default width from the theme tokens. */
  pixels = $state<number | null>(saved())

  /** True while a finger or pointer is on the edge, so the panel can turn its
   *  transitions off and follow instead of easing after. */
  dragging = $state(false)

  /** How to end the drag that is on, if one is; see `release`. */
  private ending: (() => void) | null = null

  /** Puts the default back. */
  reset() {
    this.pixels = null
    keep(null)
  }

  /** The same edge, moved with a key: the arrows a step at a time, Home and End
   *  to either end, and Enter or Space the default back - which is what a double
   *  click on the handle does. True when the press was the handle's.
   *
   *  Here and not in the component, because how far a step goes and how wide the
   *  panel may be are this module's to say and the drag already says them. The
   *  panel is measured for the one case where the width is still the theme's own
   *  and there is no number yet to step from. */
  step(key: string, panel: HTMLElement | undefined): boolean {
    const from = this.pixels ?? panel?.getBoundingClientRect().width ?? NARROWEST

    const put = (width: number) => {
      this.pixels = Math.round(Math.min(WIDEST, Math.max(NARROWEST, width)))
      keep(this.pixels)
      return true
    }

    switch (key) {
      case 'ArrowLeft':
        return put(from - STEP)
      case 'ArrowRight':
        return put(from + STEP)
      case 'Home':
        return put(NARROWEST)
      case 'End':
        return put(WIDEST)
      case 'Enter':
      case ' ':
        this.reset()
        return true
      default:
        return false
    }
  }

  /** Ends the drag from outside it, for the one case where no `pointerup` will:
   *  the sidebar can be closed - Escape, the back gesture, a note chosen on a
   *  phone - while a finger is still on the edge, and then the handle goes and
   *  the window is left wearing a resize cursor with nothing selectable. */
  release() {
    this.ending?.()
  }

  /** The edge follows the pointer; letting go keeps the width. Pointer capture
   *  keeps the events coming even once the pointer has left the thin handle,
   *  which it does in the first few pixels of any drag.
   *
   *  `panel` is the element being resized, measured once at the start: reading
   *  it on every move would measure the width this drag has already set. */
  start(event: PointerEvent, panel: HTMLElement | undefined) {
    if (viewport.touch || event.button !== 0 || !panel) return

    const handle = event.currentTarget
    if (!(handle instanceof HTMLElement)) return

    const startX = event.clientX
    const from = panel.getBoundingClientRect().width

    handle.setPointerCapture(event.pointerId)
    this.dragging = true
    // The document keeps its own cursor and selection out of the way for the
    // length of the drag.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const move = (moved: PointerEvent) => {
      this.pixels = Math.round(Math.min(WIDEST, Math.max(NARROWEST, from + moved.clientX - startX)))
    }

    const stop = () => {
      if (!this.ending) return
      this.ending = null

      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)

      this.dragging = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (this.pixels !== null) keep(this.pixels)
    }

    this.ending = stop
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }
}
