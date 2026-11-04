/** Web Locks that may not work. Every window's use of them comes through here, because a
 *  lock that is missing, refuses or never answers must leave one window working as if there
 *  were no others: no slot, an engine of its own, and its writes going down. */

/** How long a lock nobody else can hold may take to come, before it counts as broken. */
const ANSWERS_WITHIN = 2_000

/** The browser's locks, where it has them. */
export const locksHere = () => (globalThis.navigator as Navigator | undefined)?.locks

const probed = new WeakMap<LockManager, Promise<boolean>>()

/** Whether these locks answer: a lock of a name nobody has ever asked for comes at once
 *  from locks that work. */
export function locksWork(locks: LockManager | undefined = locksHere()): Promise<boolean> {
  if (!locks) return Promise.resolve(false)
  let answer = probed.get(locks)
  if (!answer) {
    answer = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), ANSWERS_WITHIN)
      const said = (works: boolean) => {
        clearTimeout(timer)
        resolve(works)
      }
      try {
        locks
          .request(`nib:probe:${crypto.randomUUID()}`, { ifAvailable: true }, (lock) => {
            said(lock !== null)
            return undefined
          })
          .catch(() => said(false))
      } catch {
        said(false)
      }
    })
    probed.set(locks, answer)
  }
  return answer
}

export type Held = 'held' | 'taken' | 'broken'

/** Takes a lock if nobody holds it, for as long as `work` runs, and answers how it went.
 *  Never throws and never hangs on the browser's account. */
export function ifFree(
  locks: LockManager,
  name: string,
  work: () => Promise<unknown>,
): Promise<Held> {
  return new Promise((resolve) => {
    let answered = false
    const answer = (held: Held) => {
      answered = true
      clearTimeout(timer)
      resolve(held)
    }
    const timer = setTimeout(() => answer('broken'), ANSWERS_WITHIN)
    try {
      locks
        .request(name, { ifAvailable: true }, (lock) => {
          // Too late: this window has gone on without it.
          if (answered) return undefined
          answer(lock ? 'held' : 'taken')
          return lock ? work() : undefined
        })
        .catch(() => {
          if (!answered) answer('broken')
        })
    } catch {
      answer('broken')
    }
  })
}

/** Holds a lock for as long as `run` runs, waiting in line for it: a window that leads
 *  or answers for the others until it goes. With locks that are missing, refuse or do not
 *  answer `run` runs at once, as the one window there is. Stopped by `signal` while waiting,
 *  nothing runs. */
export function heldForLife(name: string, run: () => Promise<unknown>, signal?: AbortSignal): void {
  let started = false
  const go = () => {
    if (started) return undefined
    started = true
    return run()
  }
  const locks = locksHere()
  if (!locks) {
    void go()
    return
  }
  void locksWork(locks).then((works) => {
    if (!works) {
      if (!signal?.aborted) void go()
      return
    }
    try {
      locks.request(name, signal ? { signal } : {}, go).catch(() => {
        if (!signal?.aborted && !started) void go()
      })
    } catch {
      if (!signal?.aborted) void go()
    }
  })
}
