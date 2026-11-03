/** What windows that are gone left behind, for the window starting now.
 *
 *  A session is one window's (slot.ts), and the next launch brings back the first
 *  window's. A draft's words live only in its session, so those of a window nobody holds
 *  come along into this one as tabs: drafts and notes with words their file never got.
 *  The tabs with nothing unwritten in them are not: the files are there. Fetched only
 *  where there is such an entry. */

import { type Draft, panesOf, readSession, type Session } from './session'
import { ifFree, locksHere, locksWork } from '../locks'
import { log } from '../log'
import { leftLately, slotLock, slotOf } from './slot'

/** The tabs of a session whose words are nowhere else. */
export function wordsOnlyIn(session: Session): Draft[] {
  const all = session.layout
    ? panesOf(session.layout.frame).flatMap((pane) => pane.tabs)
    : (session.tabs ?? [])
  return all.filter(wordsOnly)
}

function wordsOnly(one: Draft): boolean {
  return one.dirty || (one.path === null && one.doc.trim() !== '')
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

/** Hands the words in each session nobody holds to `take`, with the lock held meanwhile so
 *  that a window opening in that moment does not take them as well, and then takes them out
 *  of that session, so they move rather than copy: a reload does not take them twice. A
 *  session just left may be a reload's, and is left alone for its grace. Answers whether any
 *  was, for the caller to look again. */
export async function takeSessionsLeft(
  mine: number,
  take: (drafts: Draft[]) => Promise<void>,
  storage: Storage = localStorage,
  locks = locksHere(),
  now = Date.now(),
): Promise<boolean> {
  if (!locks || !(await locksWork(locks))) return false
  let waiting = false
  for (const { key, slot } of others(storage, mine)) {
    if (leftLately(slot, storage, now)) {
      waiting = true
      continue
    }
    let working: Promise<void> = Promise.resolve()
    const work = async () => {
      const raw = parsed(storage.getItem(key))
      const session = readSession(raw)
      const drafts = session ? wordsOnlyIn(session) : []
      if (drafts.length) await take(drafts)
      // The first window's arrangement is what the next launch reads; only the words go.
      if (slot !== 0) storage.removeItem(key)
      else if (drafts.length) storage.setItem(key, JSON.stringify(withoutWords(raw)))
    }
    await ifFree(locks, slotLock(slot), () => (working = work()))
    await working.catch((error: unknown) => {
      log('warn', `session: ${key} stays - ${String(error)}`)
    })
  }
  return waiting
}

/** A session's entry as written, without the tabs `wordsOnlyIn` takes. */
function withoutWords(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(raw)) {
    out[name] =
      name === 'tabs' && Array.isArray(value)
        ? value.filter((one) => !wordsOnly(one as Draft))
        : name === 'sides' && Array.isArray(value)
          ? value.map(withoutWords)
          : name === 'layout' || name === 'frame' || name === 'pane'
            ? withoutWords(value)
            : value
  }
  return out
}

/** Those tabs as this window will hold them. A note with unwritten words has a file, and
 *  this window or that file may have moved on since: its words are kept as a draft of its
 *  own beside it, never merged into or dropped for what is there, and only where the file
 *  or an open note here does not already say them. */
export async function asDrafts(
  drafts: readonly Draft[],
  says: (path: string) => Promise<string | null>,
): Promise<Draft[]> {
  const out: Draft[] = []
  for (const draft of drafts) {
    if (draft.path === null) {
      out.push(draft)
      continue
    }
    if ((await says(draft.path)) === draft.doc) continue
    const made: Draft = { ...draft, path: null, dirty: true }
    delete made.share
    out.push(made)
  }
  return out
}

function parsed(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}
