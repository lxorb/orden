/** What sync did, and what it is waiting on.
 *
 *  Two things a reader asks when syncing is not obviously working, and neither
 *  has had an answer: "did it run, and what did it do", and "is something
 *  stuck". The light in the corner says syncing or failed, which is the right
 *  amount to say in a corner and not enough to act on.
 *
 *  So: the last few dozen passes, one line each, with what moved and what went
 *  wrong in the server's own words. Kept on the device, because a pass is
 *  something a device did - the account's side of the same question is which
 *  device wrote a version, which the history sheet already shows. Nothing new is
 *  sent anywhere to make this work, which is why it is a list rather than a
 *  table on the server: a log nobody reads should not cost a write on every
 *  pass.
 *
 *  And the notes waiting to be settled, for the reader who asked to be asked
 *  about two copies. See conflicts.ts for the three answers and why asking is
 *  quiet rather than a dialog. */

import { isRecord, parsed } from '../stored'
import { invoke } from '../tauri'
import type { Answer, Clash } from './conflicts'

export const STORAGE_KEY = 'nib:sync-log'

/** How many passes are kept. Enough to see a pattern over an afternoon, few
 *  enough that the list is still a list. */
const KEPT = 60

/** One pass over one space. */
export interface Pass {
  at: number
  /** The space, by the name the reader knows it by. */
  space: string
  /** How many notes came down and how many went up. */
  pulled: number
  pushed: number
  /** Notes whose two copies disagreed. */
  clashed: number
  /** What went wrong, in the words the server used, or null. */
  failed: string | null
}

interface Saved {
  passes?: unknown
  clashes?: unknown
}

function isPass(value: unknown): value is Pass {
  if (!value || typeof value !== 'object') return false
  const one = value as Partial<Pass>

  return typeof one.at === 'number' && typeof one.space === 'string'
}

function isClash(value: unknown): value is Clash {
  if (!value || typeof value !== 'object') return false
  const one = value as Partial<Clash>

  return typeof one.path === 'string' && typeof one.id === 'string' && typeof one.at === 'number'
}

class Record {
  /** Newest first, which is the order anybody reads a log in. */
  passes = $state<Pass[]>([])

  /** Notes the reader asked to be asked about. */
  clashes = $state<Clash[]>([])

  /** Whether anything is waiting, which is the only thing the settings row has
   *  to say when nothing is. */
  readonly waiting = $derived(this.clashes.length)

  restore() {
    // Read as an unknown and taken field by field, like every other store that
    // reads its own storage: the entry may have been written by another version
    // of the app, or edited by hand.
    const held: unknown = parsed(localStorage.getItem(STORAGE_KEY))
    const saved: Saved = isRecord(held) ? held : {}

    this.passes = Array.isArray(saved.passes) ? saved.passes.filter(isPass).slice(0, KEPT) : []
    this.clashes = Array.isArray(saved.clashes) ? saved.clashes.filter(isClash) : []
  }

  /** One pass, written down. Nothing is written for a pass that found nothing
   *  and went wrong with nothing: a log of "nothing happened" every twenty
   *  seconds is a log nobody can read. */
  wrote(pass: Pass) {
    if (!pass.pulled && !pass.pushed && !pass.clashed && !pass.failed) return

    this.passes = [pass, ...this.passes].slice(0, KEPT)
    this.persist()
  }

  /** A note whose copies disagree, waiting for an answer. One per path: a
   *  second pass finding the same disagreement is the same disagreement. */
  clash(clash: Clash) {
    if (this.clashes.some((one) => one.path === clash.path)) return

    this.clashes = [...this.clashes, clash]
    this.persist()
  }

  /** The paths a pass must leave alone, which is every one still waiting. */
  readonly held = $derived(new Set(this.clashes.map((one) => one.path)))

  /** Settles one: keep what is here, take what the account holds, or keep both.
   *
   *  Only the files are touched. Nothing is sent: letting go of the clash is what
   *  lets the next pass push, and the pass is the one thing that knows which
   *  version it would be writing on top of. So an answer costs no request, and an
   *  answer given with the network down is still the answer when it comes back.
   *
   *  Whichever is chosen, the words that lose are kept as a version first, so
   *  this is never the moment something goes for good. */
  async settle(clash: Clash, answer: Answer): Promise<void> {
    if (answer === 'theirs') {
      const here = await invoke<string>('read_note', { path: clash.path }).catch(() => null)
      if (here?.trim()) {
        await invoke('snapshot_note', { path: clash.path, content: here }).catch(() => undefined)
      }

      await invoke('write_note', { path: clash.path, content: clash.theirs })
    }

    if (answer === 'both') {
      const { conflictPath } = await import('./conflicts')
      await invoke('write_note', { path: conflictPath(clash.path), content: clash.theirs })
    }

    this.forget(clash.path)
  }

  forget(path: string) {
    this.clashes = this.clashes.filter((one) => one.path !== path)
    this.persist()
  }

  /** Everything, for somebody who wants the list gone. */
  clear() {
    this.passes = []
    this.persist()
  }

  private persist() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ passes: this.passes, clashes: this.clashes }),
      )
    } catch {
      // A browser with storage turned off still syncs; it just forgets the log.
    }
  }
}

export const record = new Record()
