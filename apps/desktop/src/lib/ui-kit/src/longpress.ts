const HOLD = 500

const SLOP = 10

export function longPress(node: HTMLElement, show: (event: MouseEvent) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let startX = 0
  let startY = 0
  let fired = false

  const cancel = () => {
    clearTimeout(timer)
    timer = undefined
  }

  const onEnd = (event: TouchEvent) => {
    cancel()
    if (!fired) return

    fired = false
    if (event.cancelable) event.preventDefault()
  }

  const onStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined
    if (!touch) {
      cancel()
      return
    }

    startX = touch.clientX
    startY = touch.clientY
    fired = false

    timer = setTimeout(() => {
      timer = undefined
      fired = true

      node.dispatchEvent(new CustomEvent('longpress', { bubbles: true }))
      show(
        new MouseEvent('contextmenu', {
          clientX: startX,
          clientY: startY,
          bubbles: true,
          cancelable: true,
        }),
      )
    }, HOLD)
  }

  const onMove = (event: TouchEvent) => {
    const touch = event.touches[0]
    if (!touch) return

    if (Math.abs(touch.clientX - startX) > SLOP || Math.abs(touch.clientY - startY) > SLOP) {
      cancel()
    }
  }

  node.addEventListener('touchstart', onStart, { passive: true })
  node.addEventListener('touchmove', onMove, { passive: true })
  node.addEventListener('touchend', onEnd)
  node.addEventListener('touchcancel', cancel)
  node.addEventListener('orden-took-over', cancel)

  return {
    update(next: (event: MouseEvent) => void) {
      show = next
    },
    destroy() {
      cancel()
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', cancel)
      node.removeEventListener('orden-took-over', cancel)
    },
  }
}
