const ANSWERS_WITHIN = 2_000

const OR_ALMOST = 100

export const locksHere = () => (globalThis.navigator as Navigator | undefined)?.locks

const probed = new WeakMap<LockManager, Promise<boolean>>()

export function locksWork(locks: LockManager | undefined = locksHere()): Promise<boolean> {
  if (!locks) return Promise.resolve(false)
  let answer = probed.get(locks)
  if (!answer) {
    answer = new Promise<boolean>((resolve) => {
      let waited = false
      const timer = setTimeout(() => {
        waited = true
        setTimeout(() => resolve(false), OR_ALMOST)
      }, ANSWERS_WITHIN)
      const said = (works: boolean) => {
        clearTimeout(timer)
        resolve(works)
        if (waited && works) probed.set(locks, Promise.resolve(true))
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

export async function inTurn<T>(
  name: () => string,
  run: () => Promise<T>,
  patience: number,
): Promise<T> {
  const locks = locksHere()
  if (!locks || !(await locksWork(locks))) return run()
  return new Promise<T>((resolve, reject) => {
    let started = false
    const go = () => {
      if (started) return undefined
      started = true
      clearTimeout(timer)
      return (async () => run())().then(resolve, reject)
    }
    const timer = setTimeout(() => void go(), patience)
    try {
      locks.request(name(), go).catch(go)
    } catch {
      void go()
    }
  })
}

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
    let timer = setTimeout(() => {
      timer = setTimeout(() => answer('broken'), OR_ALMOST)
    }, ANSWERS_WITHIN)
    try {
      locks
        .request(name, { ifAvailable: true }, (lock) => {
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
  void (async () => {
    let works = await locksWork(locks)
    if (!works) {
      await new Promise((later) => setTimeout(later, ANSWERS_WITHIN))
      works = await locksWork(locks)
    }
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
  })()
}

export async function holdIfFree(name: string): Promise<(() => void) | null> {
  const locks = locksHere()
  if (!locks || !(await locksWork(locks))) return () => undefined
  let release = (): unknown => undefined
  const holding = new Promise((done) => (release = () => done(undefined)))
  const held = await ifFree(locks, name, () => holding)
  return held === 'taken' ? null : () => void release()
}
