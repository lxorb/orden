import { carryThumb } from '../../ui-kit/src/api'

const HOLD_TO_LIFT = 250
const SLOP = 8
export interface Lifting {
  start: () => boolean
  over: (x: number, y: number, under: Element | null) => void
  land: () => void
  cancel: () => void
}
export function touchLift(node: HTMLElement, host: Lifting) {
  let holding: ReturnType<typeof setTimeout> | null = null
  let from = { x: 0, y: 0 }
  let ghost: HTMLElement | null = null
  let moved = false
  let last: Element | null = null
  let started = false
  const tell = (under: Element | null, point: { x: number; y: number } | null) =>
    under?.dispatchEvent(new CustomEvent('orden-todo-lift', { bubbles: true, detail: point }))
  const unhold = () => {
    if (holding !== null) clearTimeout(holding)
    holding = null
  }
  const end = (landed: boolean) => {
    unhold()
    window.removeEventListener('touchmove', move)
    window.removeEventListener('touchend', up)
    window.removeEventListener('touchcancel', away)
    tell(last, null)
    last = null
    ghost?.remove()
    ghost = null
    if (started) carryThumb(false)
    const was = started
    started = false
    moved = false
    if (!was) return
    if (landed) host.land()
    else host.cancel()
  }
  const move = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!touch || !ghost) return
    if (event.cancelable) event.preventDefault()
    if (!moved) {
      if (Math.hypot(touch.clientX - from.x, touch.clientY - from.y) <= SLOP) return
      moved = true
      node.dispatchEvent(new CustomEvent('orden-took-over'))
    }
    ghost.style.transform = `translate(${touch.clientX - from.x}px, ${touch.clientY - from.y}px) scale(1.03)`
    const under = document.elementFromPoint(touch.clientX, touch.clientY)
    if (under !== last) tell(last, null)
    last = under
    tell(under, { x: touch.clientX, y: touch.clientY })
    host.over(touch.clientX, touch.clientY, under)
  }
  const up = (event: TouchEvent) => {
    if (moved && event.cancelable) event.preventDefault()
    end(moved)
  }
  const away = () => end(false)
  const lift = () => {
    holding = null
    if (!host.start()) return
    started = true
    carryThumb(true)
    const box = node.getBoundingClientRect()
    const copy = node.cloneNode(true)
    if (!(copy instanceof HTMLElement)) return
    copy.classList.add('carried')
    copy.setAttribute('aria-hidden', 'true')
    Object.assign(copy.style, {
      position: 'fixed',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      margin: '0',
      pointerEvents: 'none',
      zIndex: 'var(--z-carried)',
      transform: 'scale(1.03)',
    })
    document.body.append(copy)
    ghost = copy
    window.addEventListener('touchmove', move, { passive: false })
    window.addEventListener('touchend', up)
    window.addEventListener('touchcancel', away)
  }
  const down = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined
    if (!touch || ghost || (event.target instanceof Element && event.target.closest('input, textarea, button.act'))) {
      unhold()
      return
    }
    from = { x: touch.clientX, y: touch.clientY }
    unhold()
    holding = setTimeout(lift, HOLD_TO_LIFT)
  }
  const stray = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!touch || holding === null) return
    if (Math.hypot(touch.clientX - from.x, touch.clientY - from.y) > SLOP) unhold()
  }
  const menu = () => {
    if (!moved) end(false)
  }
  node.addEventListener('touchstart', down, { passive: true })
  node.addEventListener('touchmove', stray, { passive: true })
  node.addEventListener('touchend', unhold)
  node.addEventListener('longpress', menu)
  return {
    update(next: Lifting) {
      host = next
    },
    destroy() {
      end(false)
      node.removeEventListener('touchstart', down)
      node.removeEventListener('touchmove', stray)
      node.removeEventListener('touchend', unhold)
      node.removeEventListener('longpress', menu)
    },
  }
}
