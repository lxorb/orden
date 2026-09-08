import { flushSync } from 'svelte'
import { CLAIM, claimsGesture, scrollsSideways, SETTLE_MAX, SETTLE_MIN, settleOpen } from './swipe'
import { workspace } from './workspace.svelte'

/** The sidebar as a phone shows it: a drawer that follows the thumb.
 *
 *  The maths of the gesture - when a sideways move counts as a drag, and where
 *  the drawer lands when the finger lifts - lives in `swipe.ts` and is tested
 *  there. This is the part that needs a real element: measuring how far the
 *  drawer can travel, and driving the transform while a finger is down. */
class Drawer {
  /** How far the drawer is pulled out while a finger is on it, in pixels.
   *  `null` hands it back to CSS, which is what animates the settle. */
  at = $state<number | null>(null)

  /** How far it can travel, measured when the gesture starts. */
  width = $state(0)

  /** How long the drawer takes to settle once the finger lifts, in
   *  milliseconds. The tap-to-open transition is tuned to feel prompt, which
   *  is far too quick for the last stretch of a drag: the drawer would leap
   *  the rest of the way. Set from how far it still has to go, and cleared
   *  once it has arrived so a tap goes back to being prompt. */
  settle = $state<number | null>(null)

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
    let claimed = false
    let openedByDrag = false
    /** The drawer is only as wide as the rail until the sidebar inside it
     *  mounts, so opening has to re-measure once it has. */
    let measured = false
    let lastX = 0
    let lastAt = 0
    let velocity = 0

    const panels = () => host.querySelector<HTMLElement>('.panels')

    /** The one finger on the screen, or nothing when there is not exactly one:
     *  a second finger is a pinch or a two-finger scroll, and neither is this. */
    const single = (event: TouchEvent) =>
      event.touches.length === 1 ? event.touches[0] : undefined

    const onStart = (event: TouchEvent) => {
      claimed = false
      openedByDrag = false
      measured = false
      // Cleared first, because every way out of this handler is a gesture the
      // drawer is not in: a width left over from the last one would let the
      // moves through, measured against a starting point that is no longer on
      // the screen, and the drawer would leap out under a finger that was
      // scrolling a table.
      width = 0

      const touch = single(event)
      if (!touch) return

      // From anywhere on the screen, not just the edge: an edge-only gesture is
      // a thin target and easy to miss. The one thing that outranks it is
      // something that scrolls sideways under the finger.
      if (scrollsSideways(document.elementFromPoint(touch.clientX, touch.clientY), host)) return

      startX = touch.clientX
      startY = touch.clientY
      lastX = touch.clientX
      lastAt = event.timeStamp
      velocity = 0
      // Zero means there is nothing to drag, and every later handler bails.
      width = panels()?.getBoundingClientRect().width ?? 0
      this.width = width
    }

    const onMove = (event: TouchEvent) => {
      const touch = single(event)
      if (!touch || !width) return

      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      if (!claimed) {
        // Settled once: a scroll stays a scroll for the whole gesture, and a
        // drag stays a drag. Going vertical first gives the drawer up.
        if (Math.abs(dy) > CLAIM) {
          width = 0
          return
        }
        if (!claimsGesture(dx, dy)) return
        // Closed, only a rightward pull opens it; a leftward one on the
        // document means nothing and should be left alone.
        if (!workspace.panel && dx < 0) {
          width = 0
          return
        }

        claimed = true

        if (!workspace.panel) {
          workspace.showPanel('tree')
          openedByDrag = true

          // Closed, the drawer is only as wide as the rail, and dragging
          // against that width would snap it open in a few pixels. `flushSync`
          // puts the sidebar in the DOM now so the real width can be read -
          // waiting a frame would be at the mercy of a throttled clock.
          flushSync()
          width = panels()?.getBoundingClientRect().width ?? width
          this.width = width
        }

        measured = true
      }

      if (!measured) return

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

      if (settled !== !!workspace.panel) workspace.showPanel(workspace.panel ?? 'tree')
    }

    host.addEventListener('touchstart', onStart, { passive: true })
    host.addEventListener('touchmove', onMove, { passive: false })
    host.addEventListener('touchend', onEnd)
    host.addEventListener('touchcancel', onEnd)

    return () => {
      host.removeEventListener('touchstart', onStart)
      host.removeEventListener('touchmove', onMove)
      host.removeEventListener('touchend', onEnd)
      host.removeEventListener('touchcancel', onEnd)
    }
  }
}

export const drawer = new Drawer()
