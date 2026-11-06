export const CLAIM = 12

export function ownsEveryTouch(action: string): boolean {
  if (action === 'auto' || action === 'manipulation') return false
  return !action.includes('pan-')
}

export function ownsGesture(from: Element | null, stopAt: Element, atDrawerEdge = false): boolean {
  for (let node: Element | null = from; node && node !== stopAt; node = node.parentElement) {
    if (node.hasAttribute('data-turns-pages') && !atDrawerEdge) return true

    const style = getComputedStyle(node)
    if (ownsEveryTouch(style.touchAction)) return true

    if (node.scrollWidth <= node.clientWidth + 1) continue
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true
  }

  return false
}

export function isFinger(pointer: string): boolean {
  return pointer !== 'pen'
}

function alongLine(x: number, factor: number): number {
  return factor === 1 ? x : window.innerWidth - x
}

export function fromEdge(x: number, factor: number, sign: number): number {
  return alongLine(x, factor * sign)
}

export function opensDrawer(x: number, edge: number, anywhere: boolean): boolean {
  return anywhere || x <= edge
}

const FLICK = 0.5

export const SETTLE_MIN = 200
export const SETTLE_MAX = 380

export function settleOpen(offset: number, width: number, velocity: number): boolean {
  if (Math.abs(velocity) >= FLICK) return velocity > 0
  return offset >= width / 2
}

export function claimsGesture(dx: number, dy: number): boolean {
  return Math.abs(dx) > CLAIM && Math.abs(dx) > Math.abs(dy)
}
