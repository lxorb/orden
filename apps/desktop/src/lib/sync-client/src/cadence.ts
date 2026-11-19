import { pollDelay } from '../../platform/src/api'

export const NUDGE = 2_000
export const FALLBACK = 30_000
const HIDDEN_FALLBACK = 5 * 60_000
export const ONLINE_POLL = 5_000
export interface Moment {
  waiting: boolean
  local: boolean
  hubOpen: boolean
  hidden: boolean
  online: boolean
  quiet: number
}
export function nextPassIn(at: Moment): number {
  if (at.waiting) return NUDGE
  if (at.local) return HIDDEN_FALLBACK
  if (at.hubOpen) return at.hidden ? HIDDEN_FALLBACK : FALLBACK
  if (at.online && !at.hidden) return ONLINE_POLL
  return pollDelay(at.quiet, at.hidden)
}
export interface Passing {
  run(): Promise<void>
  owed(): boolean
  fire(): void
  next(): number | null
}
export class Cadence {
  running: Promise<void> | null = null
  private again = false
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly how: Passing) {}
  go(): void {
    clearTimeout(this.timer)
    if (this.running) {
      this.again = true
      return
    }
    this.running = this.how.run().finally(() => {
      this.running = null
      const again = this.again && this.how.owed()
      this.again = false
      const next = again ? null : this.how.next()
      if (again) this.go()
      else if (next !== null) this.in(next)
    })
  }
  in(ms: number): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.how.fire(), ms)
  }
  stop(): void {
    clearTimeout(this.timer)
    this.again = false
  }
}
