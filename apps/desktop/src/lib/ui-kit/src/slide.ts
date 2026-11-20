import type { TransitionConfig } from 'svelte/transition'
import { cubicOut } from 'svelte/easing'
import { dur } from '../../platform/src/api'

const STEP = 6
export const LIST_STEP = 8
const SWAP = 130
interface Slip {
  y?: number
  ms?: number
}
function slip(y: number, ms: number): TransitionConfig {
  return {
    duration: dur(ms),
    easing: cubicOut,
    css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`,
  }
}
export function arrive(_node: Element, { y = STEP, ms = SWAP }: Slip = {}): TransitionConfig {
  return slip(y, ms)
}
export function leave(_node: Element, { y = -STEP, ms = SWAP }: Slip = {}): TransitionConfig {
  return slip(y, ms)
}
export function letGo(_node: Element, { ms = SWAP }: { ms?: number } = {}): TransitionConfig {
  return { duration: dur(ms), css: () => 'pointer-events: none' }
}
type Measure = () => () => void
const placing = new Set<Measure>()
let placingFrame = 0
function placeSoon(measure: Measure) {
  placing.add(measure)
  placingFrame ||= requestAnimationFrame(() => {
    placingFrame = 0
    const now = [...placing]
    placing.clear()
    for (const paint of now.map((one) => one())) paint()
  })
}
export function segmented(node: HTMLElement) {
  const thumb = document.createElement('span')
  thumb.className = 'orden-segmented-thumb'
  thumb.setAttribute('aria-hidden', 'true')
  thumb.style.transition = 'none'
  thumb.style.opacity = '0'
  node.prepend(thumb)
  node.classList.add('has-thumb')
  let settled = 0
  let shown = false
  const measure: Measure = () => {
    const on = node.querySelector<HTMLElement>('button.on')
    if (!on) return () => (thumb.style.opacity = '0')
    const [width, height, left, top] = [on.offsetWidth, on.offsetHeight, on.offsetLeft, on.offsetTop]
    return () => {
      thumb.style.opacity = ''
      thumb.style.width = `${width}px`
      thumb.style.height = `${height}px`
      thumb.style.transform = `translate(${left}px, ${top}px)`
      if (shown) return
      shown = true
      settled = requestAnimationFrame(() => (thumb.style.transition = ''))
    }
  }
  const soon = () => placeSoon(measure)
  soon()
  const watched = new MutationObserver(soon)
  watched.observe(node, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  })
  const measured = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null
  measured?.observe(node)
  return {
    destroy() {
      placing.delete(measure)
      cancelAnimationFrame(settled)
      watched.disconnect()
      measured?.disconnect()
      thumb.remove()
      node.classList.remove('has-thumb')
    },
  }
}
