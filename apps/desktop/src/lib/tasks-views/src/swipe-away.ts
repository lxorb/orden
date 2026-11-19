const AWAY = 0.35
const SLOP = 8
export const swipedAway = (dx: number, dy: number, wide: number): boolean =>
  wide > 0 && Math.abs(dx) > wide * AWAY && Math.abs(dx) > Math.abs(dy) * 2
export function swipeAway(node: HTMLElement, away: () => void) {
  let from: { x: number; y: number; id: number } | null = null
  let sliding = false
  const reset = () => {
    from = null
    sliding = false
    node.style.translate = ''
    node.style.opacity = ''
  }
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') return
    from = { x: event.clientX, y: event.clientY, id: event.pointerId }
    node.style.transition = 'none'
  }
  const move = (event: PointerEvent) => {
    if (from?.id !== event.pointerId) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    if (!sliding && Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy) * 2) sliding = true
    if (!sliding) return
    node.style.translate = `${dx}px 0`
    node.style.opacity = String(Math.max(0.3, 1 - Math.abs(dx) / node.offsetWidth))
  }
  const up = (event: PointerEvent) => {
    if (from?.id !== event.pointerId) return
    const gone = sliding && swipedAway(event.clientX - from.x, event.clientY - from.y, node.offsetWidth)
    node.style.transition = ''
    reset()
    if (gone) away()
  }
  const cancel = () => {
    node.style.transition = ''
    reset()
  }
  node.addEventListener('pointerdown', down)
  node.addEventListener('pointermove', move)
  node.addEventListener('pointerup', up)
  node.addEventListener('pointercancel', cancel)
  return {
    destroy() {
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', up)
      node.removeEventListener('pointercancel', cancel)
    },
  }
}
