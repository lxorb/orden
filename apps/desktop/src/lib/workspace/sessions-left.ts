/** What windows that are gone left behind, for the window starting now.
 *
 *  A session is one window's (slot.ts), and the next launch brings back the first
 *  window's. A draft's words live only in its session, so those of a window nobody holds
 *  come along into this one as tabs: drafts and notes with words their file never got.
 *  The tabs with nothing unwritten in them are not: the files are there. Fetched only
 *  where there is such an entry. */

import { unixLines } from './documents.svelte'
import { type Draft, readClosed, readDraft } from './session'
import { ifFree, locksHere, locksWork } from '../locks'
import { log } from '../log'
import { isNumber, isRecord } from '../stored'
import { leftLately, slotLock, slotOf } from './slot'
import { TAB_KINDS } from './tab-kinds'
import { mergedOver } from './unwritten'

function wordsOnly(one: Draft): boolean {
  if (!TAB_KINDS[one.kind].words) return false
  return one.dirty || (one.path === null && one.doc.trim() !== '')
}

/** A session's entry as written, with the tabs whose words are nowhere else out of it and
 *  into `found`. The one place that knows where an entry holds tabs: a strip anywhere in it,
 *  which is a pane of the arrangement, of a split, of a set out of sight (`sets`, of any
 *  depth) or the flat strip of an older build; and the closed stack, whose words are in
 *  Recently deleted once they have an entry there. A holder of tabs added later is a strip
 *  like these, and is found. */
function parted(value: unknown, found: Draft[]): unknown {
  if (Array.isArray(value)) return value.map((one) => parted(one, found))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [name, field] of Object.entries(value)) {
    if (name === 'tabs' && Array.isArray(field)) Object.assign(out, strip(value, field, found))
    else if (name === 'closed' && Array.isArray(field)) out[name] = stack(field, found)
    else if (name !== 'active' && name !== 'recent') out[name] = parted(field, found)
    else if (!Array.isArray(value.tabs)) out[name] = field
  }
  return out
}

/** A strip without those tabs, its tab in front and its order of use counted along what is
 *  left: both are indices into it (`PaneDraft`). */
function strip(pane: Record<string, unknown>, tabs: unknown[], found: Draft[]) {
  const moved = new Map<number, number>()
  const kept: unknown[] = []
  tabs.forEach((one, at) => {
    const draft = readDraft(one)
    if (draft && wordsOnly(draft)) {
      found.push(draft)
      return
    }
    moved.set(at, kept.length)
    kept.push(one)
  })
  const active = isNumber(pane.active) ? pane.active : 0
  // The tab in front gone: the one after it, as `built` looks for one, or the last.
  const next = tabs.findIndex((_, at) => at >= active && moved.has(at))
  return {
    tabs: kept,
    ...('active' in pane ? { active: moved.get(next) ?? Math.max(kept.length - 1, 0) } : {}),
    ...(Array.isArray(pane.recent)
      ? {
          recent: pane.recent.flatMap((at: unknown) => {
            const to = isNumber(at) ? moved.get(at) : undefined
            return to === undefined ? [] : [to]
          }),
        }
      : {}),
  }
}

/** The closed stack without those tabs. */
function stack(closed: unknown[], found: Draft[]): unknown[] {
  return closed.filter((one) => {
    const entry = readClosed(one)
    if (!entry || entry.trashed !== undefined || !wordsOnly(entry.draft)) return true
    found.push(entry.draft)
    return false
  })
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
      const drafts: Draft[] = []
      const rest = parted(parsed(storage.getItem(key)), drafts)
      if (drafts.length) await take(drafts)
      // The first window's arrangement is what the next launch reads; only the words go.
      if (slot !== 0) storage.removeItem(key)
      else if (drafts.length) storage.setItem(key, JSON.stringify(rest))
    }
    await ifFree(locks, slotLock(slot), () => (working = work()))
    await working.catch((error: unknown) => {
      log('warn', `session: ${key} stays - ${String(error)}`)
    })
  }
  return waiting
}

/** Those tabs as this window will hold them. A note with unwritten words has a file, and
 *  this window or that file may have moved on since: its words are kept as a draft of its
 *  own beside it, never merged into or dropped for what is there, and only where the file
 *  or an open note here does not already say them: as they are, or with what has been
 *  written since. Two panes on one note are one set of words, and so is what one document
 *  held earlier, a tab closed and typed on in another pane, with what it holds now: the one
 *  holding the other is kept, wherever in the session it was found. A session does not say
 *  which is later, so words taken out in between come back here, in the draft. `spaceOf` is the space the file is
 *  in, which is the draft's from here on. */
export async function asDrafts(
  drafts: readonly Draft[],
  says: (path: string) => Promise<string | null>,
  spaceOf: (path: string) => string | null = () => null,
): Promise<Draft[]> {
  const out: Draft[] = []
  for (const [at, draft] of drafts.entries()) {
    if (draft.path === null) {
      out.push(draft)
      continue
    }
    if (await saidBeside(draft, at, drafts)) continue
    if (await saidThere(draft, await says(draft.path))) continue
    const space = spaceOf(draft.path)
    const made: Draft = { ...draft, path: null, dirty: true, ...(space ? { space } : {}) }
    delete made.share
    delete made.base
    out.push(made)
  }
  return out
}

/** Whether another draft of the same document says this one's words: the same ones or more.
 *  Of drafts that each say the other, the first is kept: one always stands. */
async function saidBeside(draft: Draft, at: number, drafts: readonly Draft[]): Promise<boolean> {
  if (draft.share === undefined) return false
  for (const [there, other] of drafts.entries()) {
    if (there === at || other.share !== draft.share || other.path === null) continue
    if (other.doc !== draft.doc && !(await saidThere(draft, other.doc))) continue
    if (there < at || !(await saidThere(other, draft.doc))) return true
  }
  return false
}

/** Whether a file's words already hold a tab's unwritten ones. */
async function saidThere(draft: Draft, read: string | null): Promise<boolean> {
  if (read === null) return false
  const disk = unixLines(read)
  const words = unixLines(draft.doc)
  if (disk === words) return true
  if (draft.base === undefined || draft.kind !== 'note') return false
  return (await mergedOver(unixLines(draft.base), words, disk)) === disk
}

function parsed(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}
