interface Yields {
  yield?: () => Promise<void>
}

export function breathe(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Yields }).scheduler
  if (scheduler?.yield) return scheduler.yield()

  return new Promise((go) => setTimeout(go, 0))
}

export function idle(): Promise<void> {
  return new Promise((go) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => go())
    else setTimeout(go, 0)
  })
}

export function nextTask(): Promise<void> {
  return new Promise((go) => setTimeout(go, 0))
}
