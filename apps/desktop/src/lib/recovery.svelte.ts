/** File recovery: how often a note being written in is kept, and how long what
 *  is kept lives.
 *
 *  A version is already kept before every save. This is the other half of it: a
 *  note somebody is in the middle of, kept every few minutes whether or not it
 *  has been saved, so a crash or an edit that went wrong between two saves has
 *  something behind it. And a sweep, because a note kept every minute for a
 *  month is a disk full; the policy it sweeps by is next door in recovery.ts.
 *
 *  One timer for the app, not one per note: the tick asks the workspace for the
 *  open notes and keeps the ones whose words have moved since it last looked. It
 *  never runs per keystroke, and a note nobody has touched costs nothing. */

import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import {
  DEFAULT_DAYS,
  DEFAULT_MINUTES,
  keepDays,
  SNAPSHOT_MINUTES,
  snapshotMinutes,
} from './recovery'
import { isRecord, stored } from './stored'
import { invoke } from './tauri'
import { workspace } from './workspace.svelte'

const STORAGE_KEY = 'nib:recovery'
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

class Recovery {
  /** Minutes between versions of a note being written in. Zero is off: then a
   *  save is the only thing that keeps one. */
  every = $state<number>(DEFAULT_MINUTES)
  /** How many days a version is kept for. */
  days = $state<number>(DEFAULT_DAYS)

  private ticker: ReturnType<typeof setInterval> | undefined
  private sweeper: ReturnType<typeof setInterval> | undefined
  /** Which revision of each open note the last version kept was of, so a note
   *  nobody has touched since is not copied again. Keyed by document, since that
   *  is what the words belong to. Nothing renders from it, so it is a plain
   *  record rather than one of Svelte's. */
  private taken: Record<string, number> = {}

  restore() {
    const saved = stored(STORAGE_KEY)
    if (!isRecord(saved)) return

    this.every = snapshotMinutes(saved.every)
    this.days = keepDays(saved.days)
  }

  /** Starts the timers, and sweeps once on the way up the way the trash does.
   *  Answers the teardown for both. */
  start(): () => void {
    // Nothing has been kept this run, whatever a run before it kept.
    this.taken = {}
    this.retime()
    void this.sweep()
    this.sweeper = setInterval(() => void this.sweep(), DAY)

    return () => {
      clearInterval(this.ticker)
      clearInterval(this.sweeper)
      this.ticker = undefined
      this.sweeper = undefined
    }
  }

  setEvery(minutes: number) {
    const wanted = SNAPSHOT_MINUTES.find((one) => one === minutes)
    if (wanted === undefined || wanted === this.every) return

    this.every = wanted
    this.persist()
    this.retime()
    this.share({ recoveryEvery: wanted })
  }

  setDays(days: number) {
    const wanted = keepDays(days)
    if (wanted === this.days) return

    this.days = wanted
    this.persist()
    void this.sweep()
    this.share({ recoveryDays: wanted })
  }

  /** Takes over what the account holds, like every other setting: the last
   *  machine to choose wins, and this is a machine finding out what that was. */
  receive(remote: AccountSettings) {
    const every = remote.recoveryEvery
    if (typeof every === 'number' && snapshotMinutes(every) === every && every !== this.every) {
      this.every = every
      this.persist()
      this.retime()
    }

    const days = remote.recoveryDays
    if (typeof days === 'number' && keepDays(days) === days && days !== this.days) {
      this.days = days
      this.persist()
      void this.sweep()
    }
  }

  /** Keeps one note's words, whatever the timer is doing. What the restore in
   *  the history sheet uses, so putting an old version back is itself undoable. */
  async keep(path: string, content: string) {
    if (!content.trim()) return

    await invoke('snapshot_note', { path, content }).catch(() => undefined)
  }

  /** Every note that has been typed in since the last version of it was kept.
   *  One pass over the open notes, and nothing at all when none of them has
   *  moved.
   *
   *  Which ones those are is asked of the revision each document counts rather
   *  than of what is unsaved. A note in a space is written down as fast as it is
   *  typed and so is never unsaved, and that is almost every note there is - the
   *  ones this is here for. A revision of zero is a note nobody has touched since
   *  it was opened. */
  private async snapshot() {
    const now: Record<string, number> = {}

    for (const note of workspace.worthKeeping) {
      const last = this.taken[note.key]
      now[note.key] = note.revision
      if (!note.revision || last === note.revision) continue

      await this.keep(note.path, note.text)
    }

    // Notes that have since been closed drop out, so a long sitting does not
    // leave a key behind for every note that was ever open in it.
    this.taken = now
  }

  private async sweep() {
    await invoke<number>('purge_snapshots', { days: this.days }).catch(() => 0)
  }

  /** One interval, restarted when the setting changes and gone while it is
   *  off. */
  private retime() {
    clearInterval(this.ticker)
    this.ticker = undefined
    if (!this.every) return

    this.ticker = setInterval(() => void this.snapshot(), this.every * MINUTE)
  }

  private share(patch: AccountSettings) {
    const token = account.token
    if (!token) return

    void api.saveSettings(token, patch).catch(() => undefined)
  }

  private persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ every: this.every, days: this.days }))
  }
}

export const recovery = new Recovery()
