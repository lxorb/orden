import { flushSync } from 'svelte'
import {
  CLAIM,
  claimsGesture,
  isFinger,
  opensDrawer,
  ownsGesture,
  SETTLE_MAX,
  SETTLE_MIN,
  settleOpen,
} from './swipe'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'

/** The sidebar as a phone shows it: a drawer that follows the thumb.
 *
 *  The maths of the gesture - whose it is, when a sideways move counts as a
 *  drag, and where the drawer lands when the finger lifts - lives in `swipe.ts`
 *  and is tested there. This is the part that needs a real element: measuring
 *  how far the drawer can travel, and driving the transform while a finger is
 *  down.
 *
 *  Nothing in the move handler reads the layout. The one measurement the drag
 *  needs is taken once per screen size and remembered, so the transform under
 *  the finger is the only work a frame does. */
class Drawer {
  /** How far the drawer is pulled out while a finger is on it, in pixels.
   *  `null` hands it back to CSS, which is what animates the settle. */
  at = $state<number | null>(null)

  /** How far it can travel, measured when the gesture starts. */
  width = $state(0)

  /** A finger is down on something the drawer may move. What puts both layers
   *  on the compositor before the first move rather than on it, so the drag
   *  starts in the frame it was asked for. */
  held = $state(false)

  /** How long the drawer takes to settle once the finger lifts, in
   *  milliseconds. The tap-to-open transition is tuned to feel prompt, which
   *  is far too quick for the last stretch of a drag: the drawer would leap
   *  the rest of the way. Set from how far it still has to go, and cleared
   *  once it has arrived so a tap goes back to being prompt. */
  settle = $state<number | null>(null)

  /** The last travel measured with the sidebar in place, and the window width
   *  it was measured at. */
  private travel = 0
  private travelAt = 0

  /** Buttons inside a layer finish transitions of their own; only the layer's
   *  own slide means it has arrived. */
  arrived(event: TransitionEvent) {
    if (event.target === event.currentTarget && event.propertyName === 'transform') {
      this.settle = null
    }
  }

  /** Listens on the element that holds both layers. Attached by hand rather
   *  than with `ontouchmove`, because claiming the gesture means calling
   *  preventDefault, and that needs a listener that is not passive.
   *
   *  Answers the teardown, so the effect that calls this can hand it straight
   *  back to Svelte. */
  follow(host: HTMLElement): () => void {
    let startX = 0
    let startY = 0
    let width = 0
    /** Whether this gesture could still become a drag. Cleared the moment it
     *  turns out to be something else, and every later handler bails. */
    let candidate = false
    let claimed = false
    let openedByDrag = false
    let ready = false
    let lastX = 0
    let lastAt = 0
    let velocity = 0
    /** What is on the screen. A stylus reaches a webview as a touch as well as
     *  a pointer, and only the pointer says which it is, so the kind is taken
     *  from the pointer event that runs first. */
    let pointer = 'touch'

    /** How near the left edge a drag has to start on a tablet. Read from the
     *  tokens as the gesture is wired up, never during one. */
    const edge = edgeWidth()

    /** The one finger on the screen, or nothing when there is not exactly one:
     *  a second finger is a pinch or a two-finger scroll, and neither is this. */
    const single = (event: TouchEvent) =>
      event.touches.length === 1 ? event.touches[0] : undefined

    const onPointerDown = (event: PointerEvent) => {
      pointer = event.pointerType
    }

    const onStart = (event: TouchEvent) => {
      candidate = false
      claimed = false
      openedByDrag = false
      ready = false
      width = 0
      this.held = false

      const touch = single(event)
      if (!touch || !isFinger(pointer) || isStylus(touch)) return

      // Whatever is under the finger gets first refusal: a table that scrolls
      // sideways, a strip of tabs, a canvas being drawn on.
      if (ownsGesture(document.elementFromPoint(touch.clientX, touch.clientY), host)) return

      // Closed, only the edge strip opens it on a tablet, where the note is a
      // page wide enough to be written and drawn on. Open, the drag that puts
      // it away may start anywhere over the note.
      const anywhere = viewport.device === 'phone'
      if (!workspace.panel && !opensDrawer(touch.clientX, edge, anywhere)) return

      startX = touch.clientX
      startY = touch.clientY
      lastX = touch.clientX
      lastAt = event.timeStamp
      velocity = 0
      candidate = true

      // Open, the layer is there to measure and the measurement is cheap and
      // exact. Closed, it is only as wide as the rail, so what the last drag
      // at this size measured stands in - and if there is none, the claim
      // below has to lay the page out once to find it.
      width = workspace.panel ? this.measure(host) : this.remembered()
      this.width = width
      this.held = true
    }

    const onMove = (event: TouchEvent) => {
      const touch = single(event)
      if (!candidate || !touch) return

      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (!claimed) {
        // Settled once: a scroll stays a scroll for the whole gesture, and a
        // drag stays a drag. Going vertical first gives the drawer up.
        if (Math.abs(dy) > CLAIM) {
          candidate = false
          this.held = false
          return
        }
        if (!claimsGesture(dx, dy)) return
        // Closed, only a rightward pull opens it; a leftward one on the
        // document means nothing and should be left alone.
        if (!workspace.panel && dx < 0) {
          candidate = false
          this.held = false
          return
        }

        claimed = true

        if (!workspace.panel) {
          workspace.showPanel('tree')
          openedByDrag = true

          // The first drag of a session has no remembered width, and dragging
          // against the rail's would snap the drawer open in a few pixels.
          // `flushSync` puts the sidebar in the DOM now so the real width can
          // be read; every later drag has it already and this never runs.
          if (!width) {
            flushSync()
            width = this.measure(host)
            this.width = width
          }
        }

        ready = true
      }

      if (!ready || !width) return

      const elapsed = event.timeStamp - lastAt
      if (elapsed > 0) velocity = (touch.clientX - lastX) / elapsed
      lastX = touch.clientX
      lastAt = event.timeStamp

      // Opening counts from nothing; closing counts down from wide open.
      const base = openedByDrag ? 0 : width
      this.at = Math.max(0, Math.min(width, base + dx))
      event.preventDefault()
    }

    const onEnd = () => {
      this.held = false
      if (!claimed) return

      const settled = settleOpen(this.at ?? 0, width, velocity)
      // The remaining distance decides the time, so the drawer moves at
      // roughly the same pace whether it was let go near its end or its start.
      const remaining = Math.abs((this.at ?? 0) - (settled ? width : 0))
      this.settle = Math.round(
        SETTLE_MIN + (SETTLE_MAX - SETTLE_MIN) * (width ? remaining / width : 0),
      )
      this.at = null
      claimed = false
      candidate = false

      if (settled !== !!workspace.panel) workspace.showPanel(workspace.panel ?? 'tree')
    }

    host.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true })
    host.addEventListener('touchstart', onStart, { passive: true })
    host.addEventListener('touchmove', onMove, { passive: false })
    host.addEventListener('touchend', onEnd)
    host.addEventListener('touchcancel', onEnd)

    return () => {
      host.removeEventListener('pointerdown', onPointerDown, { capture: true })
      host.removeEventListener('touchstart', onStart)
      host.removeEventListener('touchmove', onMove)
      host.removeEventListener('touchend', onEnd)
      host.removeEventListener('touchcancel', onEnd)
    }
  }

  /** How far the drawer can move, with the sidebar in place to be measured.
   *  Remembered against the window's width, so turning the tablet takes the
   *  measurement again and a drag never has to. */
  private measure(host: HTMLElement): number {
    const width = host.querySelector<HTMLElement>('.panels')?.getBoundingClientRect().width ?? 0
    if (width) {
      this.travel = width
      this.travelAt = window.innerWidth
    }

    return width
  }

  /** What the last drag at this size measured, or nothing. */
  private remembered(): number {
    return this.travelAt === window.innerWidth ? this.travel : 0
  }
}

/** How near the left of the screen a drag has to start before it is the
 *  drawer's rather than the page's, from the tokens. A stylesheet that does not
 *  say leaves the whole width open, which is what a phone uses anyway. */
function edgeWidth(): number {
  const width = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--swipe-edge'),
  )

  return Number.isFinite(width) ? width : Number.POSITIVE_INFINITY
}

/** Apple's webviews name the pen on the touch rather than on the pointer, and
 *  that is the only place they name it. Cast because `touchType` is theirs and
 *  not in the standard's Touch. */
function isStylus(touch: Touch): boolean {
  return (touch as Touch & { touchType?: string }).touchType === 'stylus'
}

export const drawer = new Drawer()
