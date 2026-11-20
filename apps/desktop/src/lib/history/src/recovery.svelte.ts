import { account, AccountOwed, type AccountSettings } from '../../accounts/src/api'
import { DEFAULT_DAYS, DEFAULT_MINUTES, keepDays, SNAPSHOT_MINUTES, snapshotMinutes } from '../../snapshots/src/api'
import { heardElsewhere, isRecord, keepJson, stored, invoke } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'

export const STORAGE_KEY = 'orden:recovery'
const OWED_KEY = 'orden:recovery-owed'
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
  heard() {
    this.restore()
    if (this.sweeper === undefined) return
    this.retime()
    void this.sweep()
  }
  start(): () => void {
    this.taken = {}
    this.retime()
    void this.sweep()
    this.sweeper = setInterval(() => void this.sweep(), DAY)
    const unheard = heardElsewhere([STORAGE_KEY], () => this.heard())
    return () => {
      unheard()
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
    this.owed.follows()
    if (this.owed.standing) {
      const token = account.accountToken
      if (token) void this.owed.settle(token)
      return
    }
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
  private readonly owed = new AccountOwed(OWED_KEY, undefined, (owed) => this.backToDefaults(owed))
  private backToDefaults(owed: AccountSettings) {
    this.every = snapshotMinutes(owed.recoveryEvery)
    this.days = keepDays(owed.recoveryDays)
    this.persist()
    if (this.sweeper !== undefined) this.retime()
  }
  private share(patch: AccountSettings) {
    this.owed.send(patch)
  }
  private persist() {
    keepJson(STORAGE_KEY, { every: this.every, days: this.days })
  }
}
export const recovery = new Recovery()
