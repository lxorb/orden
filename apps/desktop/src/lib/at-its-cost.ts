import type { Later } from './platform/src/api'

export function atItsCost(run: () => void, rest = 2): Later {
  let timer: ReturnType<typeof setTimeout> | undefined
  let owed = false
  let busy = false
  let free = 0

  const settled = (done: () => void) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(done))
    else setTimeout(done)
  }

  const go = () => {
    timer = undefined
    owed = false
    busy = true
    const at = performance.now()
    run()
    settled(() => {
      busy = false
      const now = performance.now()
      free = now + (now - at) * rest
      if (owed) soon()
    })
  }

  const soon = () => {
    owed = true
    if (busy || timer !== undefined) return
    timer = setTimeout(go, Math.max(0, free - performance.now()))
  }

  soon.cancel = () => {
    clearTimeout(timer)
    timer = undefined
    owed = false
  }

  soon.flush = () => {
    if (!owed) return
    clearTimeout(timer)
    go()
  }

  return soon
}
