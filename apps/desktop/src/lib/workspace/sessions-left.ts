/** What windows that are gone left behind, for the window starting now.
 *
 *  A session is one window's (slot.ts), and the next launch brings back the first
 *  window's. A draft's words live only in its session, so those of a window nobody holds
 *  come along into this one as tabs: drafts and notes with words their file never got.
 *  The tabs with nothing unwritten in them are not: the files are there. Fetched only
 *  where there is such an entry. */

import { type Draft, panesOf, readSession, type Session } from './session'
import { locksHere, slotLock, slotOf } from './slot'

/** The tabs of a session whose words are nowhere else. */
export function wordsOnlyIn(session: Session): Draft[] {
  const all = session.layout
    ? panesOf(session.layout.frame).flatMap((pane) => pane.tabs)
    : (session.tabs ?? [])
  return all.filter((one) => one.dirty || (one.path === null && one.doc.trim() !== ''))
}

/** The entries in storage that are another window's session. */
function others(storage: Storage, mine: number): { key: string; slot: number }[] {
  const out: { key: string; slot: number }[] = []
  for (let at = 0; at < storage.length; at += 1) {
    const key = storage.key(at)
    const slot = key === null ? null : slotOf(key)
    if (key !== null && slot !== null && slot !== mine) out.push({ key, slot })
  }
  return out
}

/** Hands each session nobody holds to `take`, with the lock held meanwhile so that a window
 *  opening in that moment does not take it as well, and drops it once it is taken. The
 *  first window's entry stays: it is what the next launch reads and it is never a stranger's. */
export async function takeSessionsLeft(
  mine: number,
  take: (drafts: Draft[]) => Promise<void>,
  storage: Storage = localStorage,
  locks = locksHere(),
): Promise<void> {
  if (!locks) return
  for (const { key, slot } of others(storage, mine)) {
    await locks.request(slotLock(slot), { ifAvailable: true }, async (lock) => {
      if (!lock) return
      const session = readSession(parsed(storage.getItem(key)))
      const drafts = session ? wordsOnlyIn(session) : []
      if (drafts.length) await take(drafts)
      if (slot !== 0) storage.removeItem(key)
    })
  }
}

function parsed(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}
