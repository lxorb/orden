import type { Row } from '@orden/bases'
import { type Hidden, MOST, plan, type Reminder, samePlan } from './plan'

export const QUIET = 400

const AT_MOST = 6 * 3_600_000

export interface Host {
  rows(): readonly Row[]
  ready(): boolean
  watch(listener: () => void): () => void
  auto(): number | null
  hidden?: Hidden
  now(): number
  hand(plan: readonly Reminder[]): Promise<boolean>
  ring(plan: readonly Reminder[]): void
  waiting(any: boolean): void
  later(run: () => void, ms: number): () => void
}

export class Scheduler {
  private handed: Reminder[] | null = null
  private pending: (() => void) | null = null
  private next: (() => void) | null = null
  private passing: Promise<void> | null = null
  private again = false

  constructor(private readonly host: Host) {}

  start(): () => void {
    const stop = this.host.watch(() => this.changed())
    this.changed()
    return () => {
      stop()
      this.pending?.()
      this.next?.()
    }
  }

  changed() {
    this.pending?.()
    this.pending = this.host.later(() => {
      this.pending = null
      void this.pass()
    }, QUIET)
  }

  async pass(): Promise<void> {
    if (this.passing) {
      this.again = true
      return this.passing
    }
    this.passing = this.run().finally(() => {
      this.passing = null
    })
    await this.passing
    if (this.again) {
      this.again = false
      await this.pass()
    }
  }

  private async run() {
    if (!this.host.ready()) return

    const now = this.host.now()
    const wanted = plan(this.host.rows(), now, this.host.auto(), MOST, this.host.hidden)
    this.host.waiting(wanted.length > 0)
    this.wake(wanted, now)
    if (this.handed && samePlan(this.handed, wanted)) return

    this.handed = wanted
    const system = await this.host.hand(wanted).catch(() => {
      if (this.handed === wanted) this.handed = null
      return false
    })
    this.host.ring(system ? [] : wanted)
  }

  private wake(wanted: readonly Reminder[], now: number) {
    this.next?.()
    const first = wanted[0]
    const wait = first ? Math.min(Math.max(first.at - now + 1000, 1000), AT_MOST) : AT_MOST
    this.next = this.host.later(() => {
      this.next = null
      void this.pass()
    }, wait)
  }
}
