/** Who holds an online terminal's session: one device at a time (issue 1055).
 *
 *  Any device that may type in a session can open it, but only one drives it at once.
 *  The others are told who has it and since when, and are sent nothing of it until they
 *  take it over, which hands it to them at once and tells the one that had it so. The
 *  session itself - its shell, its programs, its screen and scrollback - is `nibd`'s and
 *  never notices: the new holder says `hello` with what it last drew and is sent the
 *  rest, or the screen.
 *
 *  The lock is kept in the `Machine`'s storage, one key a session, and every change to
 *  it is made in `Machine`'s one queue, so two devices taking over at once end with one
 *  holder: whoever's frame came second. A holder that leaves - the tab closed - lets go
 *  at once; one whose socket dropped or went quiet keeps it for `HOLD_GRACE`, to come
 *  back to, and then it is free, so a device that crashed never holds it for ever.
 *
 *  Pure: what is decided here is decided from the record, the claim and whether the
 *  holder is still there, which `Machine` works out from its sockets. */

import { HOLD_GRACE } from '@orden/online/wire'

/** The lock on one session: the device holding it, whose it is, what it is called, since
 *  when, and when its last socket went (null while it is there). */
export interface Hold {
  device: string
  who: string
  name: string
  since: number
  left: number | null
}

/** A device asking for the session: by opening it (`take` false) or by Take over. */
export interface Claim {
  device: string
  who: string
  name: string
  take: boolean
}

/** The storage key a session's lock is kept under. */
export const holdKey = (session: string) => `hold:${session}`

/** A record that is a lock, or null: storage written by a later version may say more. */
export function holdOf(value: unknown): Hold | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Partial<Hold>
  if (typeof one.device !== 'string' || typeof one.since !== 'number') return null
  return {
    device: one.device,
    who: typeof one.who === 'string' ? one.who : '',
    name: typeof one.name === 'string' ? one.name : '',
    since: one.since,
    left: typeof one.left === 'number' ? one.left : null,
  }
}

/** The lock as it stands now: null where its holder is gone and its grace is over, with
 *  `left` set where it went just now, and cleared where it is back. */
export function standing(hold: Hold | null, present: boolean, now: number): Hold | null {
  if (!hold) return null
  if (present) return hold.left === null ? hold : { ...hold, left: null }
  const left = hold.left ?? now
  return now - left >= HOLD_GRACE ? null : { ...hold, left }
}

/** A claim decided: the lock after it, and whether the claimer holds the session now.
 *  The same device always does; another one where nobody holds it, or with Take over. */
export function claimed(
  hold: Hold | null,
  claim: Claim,
  present: boolean,
  now: number,
): { hold: Hold; granted: boolean } {
  if (hold?.device === claim.device) {
    return { hold: { ...hold, name: claim.name || hold.name, left: null }, granted: true }
  }
  const kept = standing(hold, present, now)
  if (kept && !claim.take) return { hold: kept, granted: false }
  return {
    hold: { device: claim.device, who: claim.who, name: claim.name, since: now, left: null },
    granted: true,
  }
}
