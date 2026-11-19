interface Yields {
  yield?: () => Promise<void>
}
export function breathe(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Yields }).scheduler
  if (scheduler?.yield) return scheduler.yield()
  return new Promise((go) => setTimeout(go, 0))
}
export const idle = (): Promise<void> =>
  new Promise((go) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => go())
    else setTimeout(go, 0)
  })
export const nextTask = (): Promise<void> => new Promise((go) => setTimeout(go, 0))
