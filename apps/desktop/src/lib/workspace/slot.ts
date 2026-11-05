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

import { ifFree, locksHere, locksWork } from '../locks'
import { forget, keep } from '../stored'
import { readSession, type Session } from './session'

export const FIRST_SESSION = 'nib:workspace'
const REMEMBERED = 'nib:window-slot'

/** More windows than anybody opens: past it, the first session, as with no locks. */
const MOST_SLOTS = 64

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

/** A window's session is being left, by a reload or for good: which the next window to
 *  start cannot tell from its lock, which has gone either way. For this long the session is
 *  left alone. */
export const LEAVING_GRACE = 10_000

const leavingMark = (slot: number) => `nib:window-left:${slot}`

/** Whether a session was left just now, so its window may yet come back for it. */
export function leftLately(slot: number, storage: Storage, now = Date.now()): boolean {
  const at = Number(storage.getItem(leavingMark(slot)))
  return at > 0 && now - at < LEAVING_GRACE
}

/** Holds a slot from here on, and says so when the window goes. */
function holdingFrom(slot: number): number {
  forget(leavingMark(slot))
  remember(slot)
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => keep(leavingMark(slot), String(Date.now())))
  }
  return slot
}

const forever = () => new Promise<never>(() => undefined)

/** A reload's own slot, waited for a moment: the page it replaces may hold it still. */
function ownAgain(locks: LockManager, slot: number): Promise<boolean> {
  return new Promise((resolve) => {
    const giving = new AbortController()
    let answered = false
    const timer = setTimeout(() => {
      answered = true
      giving.abort()
      resolve(false)
    }, RELOAD_AT_MOST)
    try {
      locks
        .request(slotLock(slot), { signal: giving.signal }, () => {
          if (answered) return undefined
          clearTimeout(timer)
          resolve(true)
          return forever()
        })
        .catch(() => {
          clearTimeout(timer)
          resolve(false)
        })
    } catch {
      clearTimeout(timer)
      resolve(false)
    }
  })
}

/** What a window with no session of its own starts on: what the first one is looking at,
 *  with no tabs, which is what a new window of VS Code or Chrome opens to. */
export function freshWindow(first: unknown): Session | null {
  const session = readSession(first)
  if (!session) return null
  const { spaces, activeSpace, panel, right, rightPanel, lastRight, known } = session
  return {
    spaces,
    activeSpace,
    panel,
    ...(right ? { right } : {}),
    ...(rightPanel ? { rightPanel } : {}),
    ...(lastRight ? { lastRight } : {}),
    ...(known ? { known } : {}),
  }
}

/** Whether another window's session is in storage: all a window alone has to ask. */
export function othersInStorage(slot: number): boolean {
  try {
    for (let at = 0; at < localStorage.length; at += 1) {
      const held = slotOf(localStorage.key(at) ?? '')
      if (held !== null && held !== slot) return true
    }
  } catch {
    // No storage to look in, and so nothing left in it.
  }
  return false
}

/** Takes this window's slot. Held until the window goes. Locks that do not work are one
 *  slot, as no locks are: this never throws, and never waits for long. */
export async function takeSlot(locks: LockManager | undefined = locksHere()): Promise<number> {
  if (!(await locksWork(locks)) || !locks) return 0
  const again = remembered()
  if (again !== null && (await ownAgain(locks, again))) return holdingFrom(again)
  for (let slot = 0; slot < MOST_SLOTS; slot += 1) {
    const held = await ifFree(locks, slotLock(slot), forever)
    if (held === 'broken') return 0
    if (held === 'held') return holdingFrom(slot)
  }
  return 0
}
