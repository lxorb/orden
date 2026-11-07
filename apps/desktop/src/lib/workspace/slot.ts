import { ifFree, locksHere, locksWork } from '../locks'
import { forget, keep } from '../stored'
import { readSession, type Session } from './session'

export const FIRST_SESSION = 'orden:workspace'
const REMEMBERED = 'orden:window-slot'

const MOST_SLOTS = 64

const RELOAD_AT_MOST = 1_500

export const slotLock = (slot: number) => `orden:window:${slot}`

export const sessionOf = (slot: number) => (slot === 0 ? FIRST_SESSION : `${FIRST_SESSION}:${slot}`)

export function slotOf(key: string): number | null {
  if (key === FIRST_SESSION) return 0
  const held = key.startsWith(`${FIRST_SESSION}:`) ? Number(key.slice(FIRST_SESSION.length + 1)) : 0
  return held > 0 && Number.isInteger(held) ? held : null
}

function remembered(): number | null {
  try {
    const said = sessionStorage.getItem(REMEMBERED)
    if (said === null) return null
    const slot = Number(said)
    return Number.isInteger(slot) && slot >= 0 ? slot : null
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

export const LEAVING_GRACE = 10_000

const leavingMark = (slot: number) => `orden:window-left:${slot}`

export function leftLately(slot: number, storage: Storage, now = Date.now()): boolean {
  const at = Number(storage.getItem(leavingMark(slot)))
  return at > 0 && now - at < LEAVING_GRACE
}

function holdingFrom(slot: number): number {
  forget(leavingMark(slot))
  remember(slot)
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => keep(leavingMark(slot), String(Date.now())))
  }
  return slot
}

const forever = () => new Promise<never>(() => undefined)

function ownAgain(locks: LockManager, slot: number): Promise<boolean> {
  return new Promise((resolve) => {
    const giving = new AbortController()
    let answered = false
    const timer = setTimeout(() => {
      answered = true
      giving.abort()
      resolve(false)
    }, RELOAD_AT_MOST)
    const refused = () => {
      clearTimeout(timer)
      resolve(false)
    }
    try {
      locks
        .request(slotLock(slot), { signal: giving.signal }, () => {
          if (answered) return undefined
          clearTimeout(timer)
          resolve(true)
          return forever()
        })
        .catch(refused)
    } catch {
      refused()
    }
  })
}

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
