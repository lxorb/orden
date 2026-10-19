/** A task row swiped on a touch screen, Todoist's way: to the right completes it, to
 *  the left schedules it. The row follows the finger over what the swipe will do, and
 *  past a third of its width (or a hand's breadth on a wide screen) letting go does it;
 *  short of that it slides back.
 *
 *  A swipe begun on the row is the row's, not the drawer's that a phone pulls out from
 *  anywhere: the touch is kept from reaching it, except at the screen's edges, where a
 *  drawer and the way back are always found. A thumb that moves up or down first is a
 *  scroll, and a hold is the row's drag (drag.svelte.ts), which a swipe moves too fast
 *  to wake. */

import { claimsGesture, CLAIM } from '../swipe'

/** How near the screen's side a touch is left to the drawer and the way back. */
const EDGE = 24

/** How far a swipe has to go, at most, to be done when the finger lifts. */
const FAR = 120

/** Which way a swipe this far along a row this wide is done, or null to slide back. */
export function swiped(dx: number, width: number): 'right' | 'left' | null {
  const far = Math.min(FAR, width / 3)
  if (dx >= far) return 'right'
  if (dx <= -far) return 'left'
  return null
}

export interface Swipes {
  /** Whether the row takes swipes at all: a touch screen's, not being edited. */
  on: boolean
  right: () => void
  left: (row: HTMLElement) => void
}

export function swipeRow(node: HTMLElement, start: Swipes) {
  let swipes = start
  let from: { x: number; y: number } | null = null
  let claimed = false
  let dx = 0

  const draw = () => {
    node.style.translate = claimed ? `${dx}px 0` : ''
    const way = claimed ? (dx > CLAIM ? 'right' : dx < -CLAIM ? 'left' : '') : ''
    const ready = claimed && swiped(dx, node.offsetWidth) !== null
    const holder = node.parentElement
    if (!holder) return
    if (way) holder.dataset.swipe = way
    else delete holder.dataset.swipe
    holder.classList.toggle('is-ready', ready)
  }

  const down = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined
    if (!swipes.on || !touch) return
    if (touch.clientX < EDGE || touch.clientX > window.innerWidth - EDGE) return
    event.stopPropagation()
    from = { x: touch.clientX, y: touch.clientY }
    claimed = false
    dx = 0
  }

  const move = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!from || !touch) return
    const x = touch.clientX - from.x
    const y = touch.clientY - from.y
    if (!claimed) {
      if (Math.abs(y) > CLAIM && Math.abs(y) >= Math.abs(x)) {
        from = null
        return
      }
      if (!claimsGesture(x, y)) return
      claimed = true
      node.classList.add('is-swiping')
    }
    event.preventDefault()
    dx = x
    draw()
  }

  const up = (event: TouchEvent) => {
    if (!from) return
    const done = claimed && event.type === 'touchend' ? swiped(dx, node.offsetWidth) : null
    from = null
    claimed = false
    dx = 0
    node.classList.remove('is-swiping')
    draw()
    if (done === 'right') swipes.right()
    else if (done === 'left') swipes.left(node)
  }

  node.addEventListener('touchstart', down, { passive: true })
  node.addEventListener('touchmove', move, { passive: false })
  node.addEventListener('touchend', up)
  node.addEventListener('touchcancel', up)
  return {
    update(next: Swipes) {
      swipes = next
    },
    destroy() {
      node.removeEventListener('touchstart', down)
      node.removeEventListener('touchmove', move)
      node.removeEventListener('touchend', up)
      node.removeEventListener('touchcancel', up)
    },
  }
}
