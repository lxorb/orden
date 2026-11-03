/** One engine per device: the election, in the browser's tabs and the app's windows alike. */

/** The lock every tab and window of the app asks for; the one holding it runs the engine. */
const LEADER = 'nib-sync'

/** Being the tab that syncs, and the way to stop being it. */
export interface Leadership {
  release(): void
}

/** Waits until this tab is the one that syncs, and answers how to stop being it; null
 *  when `signal` gave up first.
 *
 *  A Web Lock is held until the tab closes, crashes or lets go, and the browser hands it
 *  to the next tab waiting at once, so the engine moves to another tab the moment the
 *  leader's goes and never runs in two. A browser without Web Locks (they need a secure
 *  context, and every browser Orden supports has had them since 2022) leads at once: a
 *  second tab there is a second engine, the rows are the same rows, and every write is a
 *  transaction, so it costs work rather than words. */
export function leadSync(signal?: AbortSignal): Promise<Leadership | null> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (!locks) return Promise.resolve({ release: () => undefined })

  return new Promise((resolve) => {
    let release: () => void = () => undefined
    const held = new Promise<void>((done) => {
      release = done
    })

    const options: LockOptions = signal ? { signal } : {}
    locks
      .request(LEADER, options, () => {
        resolve({ release })
        return held
      })
      .catch(() => {
        // The only way the request rejects is the signal giving up before the lock was
        // granted, which is the null this answers.
        resolve(null)
      })
  })
}
