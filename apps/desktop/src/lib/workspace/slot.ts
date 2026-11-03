/** Which of the app's windows this one is, and so which session it writes.
 *
 *  A session is one window's: its tabs and panes, and the words of drafts, which live
 *  nowhere else. All windows wrote one entry, whoever wrote last holding the next launch,
 *  and a draft in the other window was then in no file, no tab and no Recently deleted.
 *
 *  So each window holds the lowest slot nobody holds, by a Web Lock, which goes with the
 *  window however it ends. The first window's entry is the one there has always been, so
 *  the session of an older build simply is the first window's after an update. A reload
 *  asks for its own slot back, because the lock of the page it replaces may take a moment
 *  to go (sessionStorage outlives a reload and nothing else does). Somewhere with no
 *  locks there is one slot, and every window shares it as they used to. */

export const FIRST_SESSION = 'nib:workspace'
const REMEMBERED = 'nib:window-slot'

/** How long a reload waits for its own slot before it takes another. */
const RELOAD_AT_MOST = 1_500

/** A slot's name for the lock, which `sessionsLeft` asks about too. */
export const slotLock = (slot: number) => `nib:window:${slot}`

/** A slot's entry in storage. */
export const sessionOf = (slot: number) => (slot === 0 ? FIRST_SESSION : `${FIRST_SESSION}:${slot}`)

/** The slot an entry in storage is, or null for any other entry. */
export function slotOf(key: string): number | null {
  if (key === FIRST_SESSION) return 0
  const held = key.startsWith(`${FIRST_SESSION}:`) ? Number(key.slice(FIRST_SESSION.length + 1)) : 0
  return held > 0 && Number.isInteger(held) ? held : null
}

function remembered(): number | null {
  try {
    const said = sessionStorage.getItem(REMEMBERED)
    const slot = said === null ? null : Number(said)
    return slot !== null && Number.isInteger(slot) && slot >= 0 ? slot : null
  } catch {
    return null
  }
}

function remember(slot: number) {
  try {
    sessionStorage.setItem(REMEMBERED, String(slot))
  } catch {
    // A slot that cannot be kept across a reload is found again by asking.
  }
}

/** Holds a lock for the life of the page, and answers whether it was had. `wait` is how
 *  long to wait for it, in milliseconds; nothing means not at all. */
function holding(locks: LockManager, name: string, wait?: number): Promise<boolean> {
  return new Promise((resolve) => {
    const forever = () => new Promise<never>(() => undefined)
    if (wait === undefined) {
      void locks.request(name, { ifAvailable: true }, (lock) => {
        resolve(lock !== null)
        return lock ? forever() : undefined
      })
      return
    }
    const giving = new AbortController()
    const late = setTimeout(() => giving.abort(), wait)
    locks
      .request(name, { signal: giving.signal }, () => {
        clearTimeout(late)
        resolve(true)
        return forever()
      })
      .catch(() => resolve(false))
  })
}

/** Takes this window's slot. Held until the window goes. */
export async function takeSlot(
  locks: LockManager | undefined = globalThis.navigator?.locks,
): Promise<number> {
  if (!locks) return 0
  const again = remembered()
  if (again !== null && (await holding(locks, slotLock(again), RELOAD_AT_MOST))) return again
  for (let slot = 0; ; slot += 1) {
    if (await holding(locks, slotLock(slot))) {
      remember(slot)
      return slot
    }
  }
}
