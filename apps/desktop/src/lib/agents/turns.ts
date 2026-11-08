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
