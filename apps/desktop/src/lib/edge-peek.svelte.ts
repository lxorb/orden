/** The file list, shut, brought out by the pointer reaching the window's edge: Zen's
 *  way (#1034). Over the note rather than beside it, so nothing moves, and only while
 *  the pointer is over it - it goes again once the pointer has left, and pinning it
 *  open is still the sidebar button's.
 *
 *  What decides it is here, with the clock and the window handed in, so every rule is
 *  a line a test can play; the column it brings out is Sidebar.svelte's (`peek`).
 *
 *  - **A moment at the edge** (`DWELL`), not a touch of it: a pointer sweeping across
 *    to a window beside this one, or flung at the corner for the close button of a
 *    window under it, passes the edge without stopping.
 *  - **Nothing held down.** A press dragged to the edge is a selection being made, a
 *    tab or a row being carried, or a window being moved, and none of those is asking
 *    for the file list.
 *  - **A pointer, not a finger**, and only where the sidebar is a column: where it is
 *    a drawer, the drawer has its own edge, and it is dragged out.
 *  - **Not over anything already open**: a menu, a sheet, the palette. And not in full
 *    screen, or while a tab fills the window, where the edge is the document's.
 *  - **Gone a moment after the pointer leaves** (`GRACE`), so a pointer that slips past
 *    its edge on the way to a row does not lose it. Not while what it opened is open -
 *    a row's menu, which hangs past its edge - nor while a name in it is being typed or
 *    a row is being carried out of it. */

/** How long the pointer rests at the edge before the list comes out. */
export const DWELL = 140
/** How long it may be away from the list before the list goes. */
export const GRACE = 320
/** How near the edge counts as at it, in pixels: a pointer stopped by the screen's own
 *  edge is at 0, and a window a pixel or two in from it still is. */
export const EDGE = 3

/** As much of a pointer event as this reads. */
export interface Moved {
  clientX: number
  clientY: number
  buttons: number
  pointerType: string
}

/** What the window says about itself, asked at the moment it matters. */
export interface Room {
  /** Whether the list may come out now: shut, a column, nothing over the note. */
  may: () => boolean
  /** How wide the window is, and whether its start edge is on the right. */
  width: () => number
  rtl: () => boolean
  /** Whether a point is on the list that came out, or on something it opened. */
  over: (x: number, y: number) => boolean
  /** Whether it is busy and must stay: a menu of its own open, a name being typed in
   *  it, a row being carried out of it. */
  busy: () => boolean
}

type Timer = ReturnType<typeof setTimeout>

export class EdgePeek {
  /** Whether the list is out over the note. */
  out = $state(false)

  private room: Room | null = null
  private coming: Timer | null = null
  private going: Timer | null = null

  /** Starts listening to the window, until the answer is called. */
  watch(room: Room): () => void {
    this.room = room
    return () => {
      this.room = null
      this.stop()
      this.out = false
    }
  }

  /** The pointer moved, anywhere in the window. */
  moved(event: Moved) {
    const room = this.room
    if (!room) return

    if (this.out) {
      if (room.over(event.clientX, event.clientY)) this.stay()
      else this.leave()
      return
    }

    const edge = room.rtl() ? event.clientX >= room.width() - 1 - EDGE : event.clientX <= EDGE
    const asking = edge && event.buttons === 0 && event.pointerType !== 'touch' && room.may()
    if (!asking) {
      this.cancelComing()
      return
    }
    this.coming ??= setTimeout(() => {
      this.coming = null
      if (this.room?.may()) this.out = true
    }, DWELL)
  }

  /** The pointer left the window altogether. */
  away() {
    this.cancelComing()
    if (this.out) this.leave()
  }

  /** Put away at once: Escape, a press past it, or the sidebar opened for good. */
  hide() {
    this.stop()
    this.out = false
  }

  private stay() {
    if (this.going === null) return
    clearTimeout(this.going)
    this.going = null
  }

  private leave() {
    this.going ??= setTimeout(() => this.gone(), GRACE)
  }

  /** The grace is over: gone, unless it is busy, in which case it asks again later -
   *  the menu it opened closing is no event the pointer makes. */
  private gone() {
    this.going = null
    if (!this.out) return
    if (this.room?.busy()) {
      this.going = setTimeout(() => this.gone(), GRACE)
      return
    }
    this.out = false
  }

  private cancelComing() {
    if (this.coming === null) return
    clearTimeout(this.coming)
    this.coming = null
  }

  private stop() {
    this.cancelComing()
    this.stay()
  }
}

export const edgePeek = new EdgePeek()
