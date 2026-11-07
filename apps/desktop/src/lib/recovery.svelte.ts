import { account } from './account.svelte'
import { api, type AccountSettings } from './api'
import {
  DEFAULT_DAYS,
  DEFAULT_MINUTES,
  keepDays,
  SNAPSHOT_MINUTES,
  snapshotMinutes,
} from './recovery'
import { isRecord, keepJson, stored } from './stored'
import { invoke } from './tauri'
import { workspace } from './workspace.svelte'

export const STORAGE_KEY = 'orden:recovery'
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

class Recovery {
  every = $state<number>(DEFAULT_MINUTES)
  days = $state<number>(DEFAULT_DAYS)

  private ticker: ReturnType<typeof setInterval> | undefined
  private sweeper: ReturnType<typeof setInterval> | undefined
  private taken: Record<string, number> = {}

  restore() {
    const saved = stored(STORAGE_KEY)
    if (!isRecord(saved)) return

    this.every = snapshotMinutes(saved.every)
    this.days = keepDays(saved.days)
  }

  start(): () => void {
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

  async keep(path: string, content: string) {
    if (!content.trim()) return

    await invoke('snapshot_note', { path, content }).catch(() => undefined)
  }

  private async snapshot() {
    const now: Record<string, number> = {}

    for (const note of workspace.worthKeeping) {
      const last = this.taken[note.key]
      now[note.key] = note.revision
      if (!note.revision || last === note.revision) continue

      await this.keep(note.path, note.text)
    }

    this.taken = now
  }

  private async sweep() {
    await invoke<number>('purge_snapshots', { days: this.days }).catch(() => 0)
  }

  private retime() {
    clearInterval(this.ticker)
    this.ticker = undefined
    if (!this.every) return

    this.ticker = setInterval(() => void this.snapshot(), this.every * MINUTE)
  }

  private share(patch: AccountSettings) {
    const token = account.accountToken
    if (!token) return

    void api.saveSettings(token, patch).catch(() => undefined)
  }

  private persist() {
    keepJson(STORAGE_KEY, { every: this.every, days: this.days })
  }
}

export const recovery = new Recovery()
