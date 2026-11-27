const TURN = 56
export function turnOf(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < TURN || Math.abs(dx) < Math.abs(dy) * 2) return 0
  return dx < 0 ? 1 : -1
}
export function swipes(node: HTMLElement, turn: (by: -1 | 1) => void) {
  let run = turn
  let from: { x: number; y: number } | null = null
  const onStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined
    const target = event.target instanceof Element ? event.target : null
    from = touch && !target?.closest('input, textarea, [data-no-swipe]') ? { x: touch.clientX, y: touch.clientY } : null
  }
  const onEnd = (event: TouchEvent) => {
    const touch = event.changedTouches[0]
    const began = from
    from = null
    if (!began || !touch) return
    const by = turnOf(touch.clientX - began.x, touch.clientY - began.y)
    if (by) run(by)
  }
  const onCancel = () => (from = null)
  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchend', onEnd)
  node.addEventListener('touchcancel', onCancel)
  return {
    update(next: (by: -1 | 1) => void) {
      run = next
    },
    destroy() {
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', onCancel)
    },
  }
}
