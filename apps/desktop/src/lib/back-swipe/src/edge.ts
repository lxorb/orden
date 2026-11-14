import type { Side } from './gesture'

export interface Scroller {
  left: number
  range: number
  rtl: boolean
  keeps: boolean
}

const SLACK = 0.5

export function taken(chain: readonly Scroller[]): Record<Side, boolean> {
  const both = { left: false, right: false }
  for (const one of chain) {
    const least = one.rtl ? -one.range : 0
    const most = one.rtl ? 0 : one.range
    if (one.left > least + SLACK) both.left = true
    if (one.left < most - SLACK) both.right = true
    if (one.keeps) return { left: true, right: true }
  }
  return both
}

export function chainOf(from: Element | null, root: Element): Scroller[] {
  const chain: Scroller[] = []
  for (let at = from; at; at = at.parentElement) {
    const style = at.ownerDocument.defaultView?.getComputedStyle(at)
    if (style) {
      const container = style.overflowX !== 'visible' && style.overflowX !== 'clip'
      const keeps =
        container &&
        (style.overscrollBehaviorX === 'contain' || style.overscrollBehaviorX === 'none')
      const sideways = /auto|scroll|overlay/.test(style.overflowX)
      const range = at.scrollWidth - at.clientWidth
      if ((sideways && range > SLACK) || keeps) {
        chain.push({
          left: at.scrollLeft,
          range: Math.max(0, range),
          rtl: style.direction === 'rtl',
          keeps,
        })
      }
    }
    if (at === root) break
  }
  return chain
}
