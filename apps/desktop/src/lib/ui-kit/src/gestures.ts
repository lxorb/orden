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
const PULL_SHARE = 0.5
const PULL_MOST = 96
const PULL_AWAY = 56
export function pullOf(dy: number): { shown: number; away: boolean } {
  const shown = Math.max(0, Math.min(dy * PULL_SHARE, PULL_MOST))
  return { shown, away: shown >= PULL_AWAY }
}
export function pulls(node: HTMLElement, refresh: () => Promise<unknown>) {
  let run = refresh
  let from: number | null = null
  let pulled = 0
  let busy = false
  const show = (px: number) => node.style.setProperty('--pulled', `${String(px)}px`)
  const onStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined
    from = touch && !busy && node.scrollTop <= 0 ? touch.clientY : null
    pulled = 0
  }
  const onMove = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (from === null || !touch) return
    if (node.scrollTop > 0) {
      from = null
      show(0)
      return
    }
    pulled = touch.clientY - from
    show(pullOf(pulled).shown)
  }
  const onEnd = () => {
    if (from === null) return
    from = null
    if (!pullOf(pulled).away) {
      show(0)
      return
    }
    busy = true
    node.dataset.refreshing = ''
    show(PULL_AWAY)
    void run()
      .catch(() => undefined)
      .then(() => {
        busy = false
        delete node.dataset.refreshing
        show(0)
      })
  }
  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchmove', onMove, { passive: true })
  node.addEventListener('touchend', onEnd)
  node.addEventListener('touchcancel', onEnd)
  return {
    update(next: () => Promise<unknown>) {
      run = next
    },
    destroy() {
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', onEnd)
    },
  }
}
