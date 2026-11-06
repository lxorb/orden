import { claimsGesture, CLAIM } from '../swipe'
import { dragging } from './drag.svelte'

const EDGE = 24

const FAR = 120

export function swiped(dx: number, width: number): 'right' | 'left' | null {
  const far = Math.min(FAR, width / 3)
  if (dx >= far) return 'right'
  if (dx <= -far) return 'left'
  return null
}

export interface Swipes {
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
    if (dragging.row) {
      from = null
      return
    }
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
