import { dur } from '../../motion'

const ENOUGH = 0.22
const LET_GO = 140
const SLOP = 10
const STIFF = 0.25

function scrollsSideways(target: EventTarget | null, node: HTMLElement, dx: number): boolean {
  for (let at = target instanceof Element ? target : null; at && at !== node;) {
    if (at instanceof HTMLElement && at.scrollWidth > at.clientWidth + 1) {
      const room = dx > 0 ? at.scrollWidth - at.clientWidth - at.scrollLeft : at.scrollLeft
      if (room > 1) return true
    }
    at = at.parentElement
  }
  return false
}

export interface Slides {
  can(step: 1 | -1): boolean
  go(step: 1 | -1): void
}

export function slides(node: HTMLElement, said: Slides) {
  let ways = said
  let offset = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let finger: { id: number; x: number; y: number; sliding: boolean } | null = null

  const place = (x: number, moving: boolean) => {
    node.style.transition = moving ? `translate ${dur(180)}ms var(--ease-out)` : 'none'
    node.style.translate = x ? `${x}px 0` : ''
  }

  const drawn = (x: number) => {
    const step = x < 0 ? 1 : -1
    return ways.can(step) ? x : x * STIFF
  }

  const settle = () => {
    const width = node.clientWidth || 1
    const step: 1 | -1 = offset < 0 ? 1 : -1
    const far = Math.abs(offset) > width * ENOUGH
    offset = 0
    if (!far || !ways.can(step)) {
      place(0, true)
      return
    }
    place(-step * width, true)
    setTimeout(() => {
      ways.go(step)
      place(step * width, false)
      requestAnimationFrame(() => requestAnimationFrame(() => place(0, true)))
    }, dur(180))
  }

  const onWheel = (event: WheelEvent) => {
    const dx = event.deltaX
    if (!dx || Math.abs(dx) <= Math.abs(event.deltaY) || event.ctrlKey) return
    if (!offset && scrollsSideways(event.target, node, dx)) return
    event.preventDefault()
    offset -= dx
    place(drawn(offset), false)
    clearTimeout(timer)
    timer = setTimeout(settle, LET_GO)
  }

  const onDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || finger) return
    finger = { id: event.pointerId, x: event.clientX, y: event.clientY, sliding: false }
  }

  const onMove = (event: PointerEvent) => {
    const held = finger
    if (held?.id !== event.pointerId) return
    const dx = event.clientX - held.x
    const dy = event.clientY - held.y
    if (!held.sliding) {
      if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(dy) * 1.5) {
        if (Math.abs(dy) > SLOP) finger = null
        return
      }
      if (scrollsSideways(event.target, node, -dx)) {
        finger = null
        return
      }
      held.sliding = true
      node.setPointerCapture(event.pointerId)
    }
    offset = dx
    place(drawn(offset), false)
  }

  const onUp = (event: PointerEvent) => {
    const held = finger
    if (held?.id !== event.pointerId) return
    const sliding = held.sliding
    finger = null
    if (sliding) settle()
  }

  node.addEventListener('wheel', onWheel, { passive: false })
  node.addEventListener('pointerdown', onDown)
  node.addEventListener('pointermove', onMove)
  node.addEventListener('pointerup', onUp)
  node.addEventListener('pointercancel', onUp)

  return {
    update(next: Slides) {
      ways = next
    },
    destroy() {
      clearTimeout(timer)
      node.removeEventListener('wheel', onWheel)
      node.removeEventListener('pointerdown', onDown)
      node.removeEventListener('pointermove', onMove)
      node.removeEventListener('pointerup', onUp)
      node.removeEventListener('pointercancel', onUp)
    },
  }
}
