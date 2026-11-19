const turns = new Map<string, Promise<unknown>>()
export function inTurn<T>(key: string, run: () => Promise<T>): Promise<T> {
  const mine = (turns.get(key) ?? Promise.resolve()).then(run, run)
  const done = mine.then(
    () => undefined,
    () => undefined,
  )
  turns.set(key, done)
  void done.then(() => {
    if (turns.get(key) === done) turns.delete(key)
  })
  return mine
}
export function waitedUntil(ms: number, until: AbortSignal | undefined): Promise<void> {
  return new Promise((go) => {
    const done = () => {
      clearTimeout(timer)
      until?.removeEventListener('abort', done)
      go()
    }
    const timer = setTimeout(done, until?.aborted ? 0 : ms)
    until?.addEventListener('abort', done, { once: true })
  })
}
export function startsBefore<T>(
  deadline: AbortSignal | undefined,
  late: () => Error,
  queue: (run: () => Promise<T>) => Promise<T>,
  run: () => Promise<T>,
): Promise<T> {
  if (!deadline) return queue(run)
  if (deadline.aborted) return Promise.reject(late())
  let begun = false
  const turn = queue(() => {
    if (deadline.aborted) return Promise.reject(late())
    begun = true
    return run()
  })
  return new Promise<T>((resolve, reject) => {
    const passed = () => {
      if (!begun) reject(late())
    }
    deadline.addEventListener('abort', passed, { once: true })
    void turn.then(resolve, reject).finally(() => deadline.removeEventListener('abort', passed))
  })
}
