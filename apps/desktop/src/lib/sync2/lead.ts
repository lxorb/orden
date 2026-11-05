/** One engine per device: the election, in the browser's tabs and the app's windows alike. */

import { locksHere, locksWork } from '../locks'

/** The lock every tab and window of the app asks for; the one holding it runs the engine. */
const LEADER = 'nib-sync'

/** Being the tab that syncs, and the way to stop being it. */
export interface Leadership {
  release(): void
}

/** Waits until this tab is the one that syncs for this account, and answers how to stop
 *  being it; null when `signal` gave up first. By account, because two accounts are two
 *  stores, and nothing of one must ever reach the other.
 *
 *  A Web Lock is held until the tab closes, crashes or lets go, and the browser hands it
 *  to the next tab waiting at once, so the engine moves to another tab the moment the
 *  leader's goes and never runs in two. Locks that are missing, refuse or never answer (they
 *  need a secure context, and every browser Orden supports has had them since 2022) lead at
 *  once: a second tab there is a second engine, the rows are the same rows, and every write
 *  is a transaction, so it costs work rather than words; a window alone is simply itself. */
export async function leadSync(signal?: AbortSignal, account = ''): Promise<Leadership | null> {
  const nobody = { release: () => undefined }
  const locks = locksHere()
  if (!locks || !(await locksWork(locks))) return nobody
  if (signal?.aborted) return null

  return new Promise((resolve) => {
    let release: () => void = () => undefined
    const held = new Promise<void>((done) => {
      release = done
    })

    const options: LockOptions = signal ? { signal } : {}
    // Refused for any reason but the signal: locks that stopped working, and so as above.
    const refused = () => resolve(signal?.aborted ? null : nobody)
    try {
      locks
        .request(`${LEADER}:${account}`, options, () => {
          resolve({ release })
          return held
        })
        .catch(refused)
    } catch {
      refused()
    }
  })
}
