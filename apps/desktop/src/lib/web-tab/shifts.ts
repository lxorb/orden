export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export function marginAround(box: Box, width: number, height: number): string {
  const top = Math.floor(box.top)
  const left = Math.floor(box.left)
  const right = Math.floor(width - (box.left + box.width))
  const bottom = Math.floor(height - (box.top + box.height))
  return `${String(-top)}px ${String(-right)}px ${String(-bottom)}px ${String(-left)}px`
}

export function sameBox(one: Box, other: Box): boolean {
  return (
    one.left === other.left &&
    one.top === other.top &&
    one.width === other.width &&
    one.height === other.height
  )
}

function boxOf(node: Element): Box {
  const { left, top, width, height } = node.getBoundingClientRect()
  return { left, top, width, height }
}

const CLIPPED_AGAIN = 1000

export function watchShifts(node: Element, shifted: () => void): () => void {
  if (typeof IntersectionObserver !== 'function') return () => undefined

  let observer: IntersectionObserver | null = null
  let again: ReturnType<typeof setTimeout> | undefined

  const unarm = () => {
    clearTimeout(again)
    observer?.disconnect()
    observer = null
  }

  const arm = (threshold = 1) => {
    unarm()
    const box = boxOf(node)
    if (box.width < 1 || box.height < 1) return

    const root = document.documentElement
    let first = true
    const heard = (entries: IntersectionObserverEntry[]) => {
      const ratio = entries[0]?.intersectionRatio ?? 1
      if (ratio !== threshold) {
        shifted()
        if (!first) arm()
        else if (ratio === 0) again = setTimeout(() => arm(1e-7), CLIPPED_AGAIN)
        else arm(ratio)
        return
      }
      if (!sameBox(box, boxOf(node))) {
        shifted()
        arm()
        return
      }
      first = false
    }
    observer = new IntersectionObserver(heard, {
      rootMargin: marginAround(box, root.clientWidth, root.clientHeight),
      threshold: Math.max(0, Math.min(1, threshold)) || 1,
    })
    observer.observe(node)
  }

  const resized = () => {
    arm()
  }
  const sizing = typeof ResizeObserver === 'function' ? new ResizeObserver(resized) : null
  sizing?.observe(node)
  window.addEventListener('resize', resized)

  arm()
  return () => {
    unarm()
    sizing?.disconnect()
    window.removeEventListener('resize', resized)
  }
}

export function watchScale(changed: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined

  let query: MediaQueryList | null = null
  const heard = () => {
    changed()
    arm()
  }
  const arm = () => {
    query?.removeEventListener('change', heard)
    query = matchMedia(`(resolution: ${String(devicePixelRatio)}dppx)`)
    query.addEventListener('change', heard)
  }

  arm()
  return () => query?.removeEventListener('change', heard)
}
