/** A finger held still on something, which is what a right click is on a
 *  touch screen.
 *
 *  Used as a Svelte action, so a row or a space says what its menu is and this
 *  decides when to ask for it:
 *
 *      <button use:longPress={(event) => menu.show(event, noteMenu(entry))}>
 *
 *  The menu wants a `MouseEvent` to place itself by, so the touch is handed
 *  over as one at the same point. */

/** Long enough not to fire on a tap, short enough not to feel like a wait. */
const HOLD = 500

/** How far the finger may stray before it counts as a drag instead. */
const SLOP = 10

export function longPress(node: HTMLElement, show: (event: MouseEvent) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let startX = 0
  let startY = 0

  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }

  const onStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return cancel()

    const touch = event.touches[0]
    startX = touch.clientX
    startY = touch.clientY

    timer = setTimeout(() => {
      timer = undefined

      // The row is being pressed, not tapped: the browser should not also
      // select the text under it or fire a click afterwards.
      node.dispatchEvent(new CustomEvent('longpress', { bubbles: true }))
      show(
        new MouseEvent('contextmenu', {
          clientX: startX,
          clientY: startY,
          bubbles: true,
          cancelable: true,
        }),
      )
    }, HOLD)
  }

  const onMove = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!touch) return

    // Moving means dragging or scrolling, and either outranks the menu.
    if (Math.abs(touch.clientX - startX) > SLOP || Math.abs(touch.clientY - startY) > SLOP) {
      cancel()
    }
  }

  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchmove', onMove, { passive: true })
  node.addEventListener('touchend', cancel)
  node.addEventListener('touchcancel', cancel)

  return {
    update(next: (event: MouseEvent) => void) {
      show = next
    },
    destroy() {
      cancel()
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', cancel)
      node.removeEventListener('touchcancel', cancel)
    },
  }
}
